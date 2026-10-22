import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

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

  const env = {
    ...process.env,
    COMFY_API_KEY: "",
    COMFY_BASE_URL: `http://127.0.0.1:${address.port}`,
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
