import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createSdkProvider,
  providerError,
  uploadTimeoutMs,
} from "../src/shared/server/comfy-provider.ts";

const run = promisify(execFile);

/** How long `work` took, and what it resolved with or the provider error it failed with. */
async function timed<T>(work: () => Promise<T>) {
  const started = performance.now();

  try {
    const value = await work();

    return { error: undefined, ms: performance.now() - started, value };
  } catch (cause) {
    return { error: providerError(cause), ms: performance.now() - started, value: undefined };
  }
}

test("an upload may outlast the job request bound, which still bounds status reads and submits", async (t) => {
  // The app's bounds scaled down: a job request gets 100 ms (30 s in the app), an upload 1.5 s.
  // Real time: the bounds are the SDK's `AbortSignal.timeout` and undici's socket timers, which
  // fake timers do not drive.
  const requestMs = 100;
  const uploadMs = 1500;
  // The stub starts reading an upload only after this long, so until then the file is still
  // on its way: the transfer outlasts the job request bound four times over.
  const transferMs = 4 * requestMs;
  const directory = mkdtempSync(join(tmpdir(), "open-photon-upload-"));

  t.after(() => rmSync(directory, { force: true, recursive: true }));

  // Larger than the socket buffers, so the client is held mid-body while the stub waits.
  const file = join(directory, "large.mp4");
  const size = 8 * 1024 * 1024;

  writeFileSync(file, randomBytes(size));

  let stalled = false;
  const requests: { authorization: string | undefined; bytes: number; route: string }[] = [];

  const server = createServer((request, response) => {
    const seen = {
      authorization: request.headers.authorization,
      bytes: 0,
      route: `${request.method} ${request.url}`,
    };

    requests.push(seen);

    if (request.method === "HEAD") {
      // No asset has these bytes yet: the file must be sent.
      response.writeHead(404).end();
    } else if (seen.route === "POST /api/v2/assets" && !stalled) {
      request.pause();
      setTimeout(() => {
        request.on("data", (chunk: Buffer) => {
          seen.bytes += chunk.length;
        });
        request.on("end", () => {
          response
            .writeHead(201, { "Content-Type": "application/json" })
            .end(JSON.stringify({ created_new: true, id: "slow-asset" }));
        });
        request.resume();
      }, transferMs);
    }
    // Anything else (a stalled upload, a status read, a submit) is never answered.
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const address = server.address();

  assert.ok(address && typeof address !== "string");
  // The SDK reads the target from the environment when a client is made.
  process.env.COMFY_BASE_URL = `http://127.0.0.1:${address.port}`;

  const provider = createSdkProvider("proxy-test-token", { requestMs, uploadMs });

  // A slow transfer completes past the job request bound, every byte streamed through.
  const upload = await timed(() => provider.upload(file));

  assert.equal(upload.error, undefined);
  assert.equal(upload.value?.info.id, "slow-asset");
  assert.ok(upload.ms >= transferMs, `the upload took ${upload.ms} ms`);
  assert.ok(
    (requests.find(({ route }) => route === "POST /api/v2/assets")?.bytes ?? 0) > size,
    "the stub received the whole file",
  );

  // One client for both, as before: the same transfer runs out of the job request's time.
  const single = createSdkProvider("proxy-test-token", { requestMs, uploadMs: requestMs });
  const cut = await timed(() => single.upload(file));

  assert.equal(cut.error?.code, "timeout");

  // A status read and a submit keep the job request bound, far short of the upload's.
  const graph = { "1": { class_type: "SaveImage", inputs: {} } };

  for (const call of [
    () => provider.job("job-1").then(({ id }) => id),
    () => provider.submit(graph, "key-1"),
  ]) {
    const { error, ms } = await timed(call);

    assert.equal(error?.code, "timeout");
    assert.ok(ms >= requestMs * 0.9 && ms < uploadMs, `a job request took ${ms} ms`);
  }

  // An upload that never completes is bounded too, by the upload bound.
  stalled = true;

  const stuck = await timed(() => provider.upload(file));

  assert.equal(stuck.error?.code, "timeout");
  assert.ok(stuck.ms >= uploadMs * 0.9, `the stalled upload gave up after ${stuck.ms} ms`);

  // Both clients send the proxy token, and only to the target.
  assert.ok(requests.length >= 7);
  assert.ok(
    requests.every(({ authorization }) => authorization === "Bearer proxy-test-token"),
    "every request carries the proxy token",
  );
});

test("COMFY_UPLOAD_TIMEOUT_MS sets the upload bound: 10 minutes unset, from 30 s to an hour", () => {
  assert.equal(uploadTimeoutMs({}), 600_000);
  assert.equal(uploadTimeoutMs({ COMFY_UPLOAD_TIMEOUT_MS: " " }), 600_000);
  assert.equal(uploadTimeoutMs({ COMFY_UPLOAD_TIMEOUT_MS: "1200000" }), 1_200_000);

  for (const value of ["29999", "3600001", "90s", "1e6.5", "-1"]) {
    assert.throws(() => uploadTimeoutMs({ COMFY_UPLOAD_TIMEOUT_MS: value }), {
      message: new RegExp(`COMFY_UPLOAD_TIMEOUT_MS must be a whole number .* not "${value}"`),
    });
  }
});

test("the SDK uses the proxy token; a Cloud/proxy conflict makes no request", async (t) => {
  const requests: { path: string | undefined; authorization: string | undefined }[] = [];

  const server = createServer((request, response) => {
    requests.push({ authorization: request.headers.authorization, path: request.url });
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { code: "not_found", message: "Unknown job" } }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  // The real SDK provider, whatever `COMFY_PROVIDER` the suite runs under.
  const env = {
    ...process.env,
    COMFY_API_KEY: "",
    COMFY_BASE_URL: `http://127.0.0.1:${address.port}`,
    COMFY_PROVIDER: "comfy",
    COMFY_PROXY_TOKEN: "proxy-test-token",
  };

  const script = `
    import { comfyProvider } from './src/shared/server/comfy-provider.ts';
    try { await comfyProvider.job('unknown-job'); }
    catch (error) { console.log(error.message); }
  `;

  await run(process.execPath, ["--input-type=module", "-e", script], { env });
  assert.deepEqual(requests, [
    { authorization: "Bearer proxy-test-token", path: "/api/v2/jobs/unknown-job" },
  ]);

  const conflict = await run(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...env, COMFY_API_KEY: "cloud-test-key" },
  });

  assert.match(conflict.stdout, /COMFY_API_KEY.*cannot be combined/);
  assert.equal(requests.length, 1);
  assert.ok(!conflict.stdout.includes("cloud-test-key"));

  await run(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...env, COMFY_PROXY_TOKEN: "" },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.authorization, undefined);
});
