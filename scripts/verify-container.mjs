import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const context = process.env.SPIKE_DOCKER_CONTEXT;
const image = process.env.SPIKE_IMAGE ?? "open-photon:latest";
const name = `open-photon-check-${randomUUID().slice(0, 8)}`;

function docker(...args) {
  const result = spawnSync("docker", [...(context ? ["--context", context] : []), ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });

  assert.equal(result.status, 0, result.stderr || result.error?.message);

  return result.stdout.trim();
}

let created = false;

try {
  docker(
    "run",
    "--detach",
    "--init",
    "--name",
    name,
    "--platform",
    "linux/amd64",
    "--env",
    "COMFY_API_KEY=container-test-dummy-key",
    "--env",
    "COMFY_BASE_URL=http://127.0.0.1:1",
    "--publish",
    "127.0.0.1::3000",
    image,
  );
  created = true;
  const address = docker("port", name, "3000/tcp");
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const base = `http://${address}`;
  let healthy = false;

  for (let attempt = 0; attempt < 90; attempt++) {
    const state = JSON.parse(docker("inspect", "--format", "{{json .State}}", name));
    assert.equal(state.Running, true, "Container exited before becoming healthy");

    if (state.Health?.Status === "healthy") {
      healthy = true;
      break;
    }

    await delay(1000);
  }

  assert.ok(healthy, "Container did not become healthy within 90 seconds");
  const page = await fetch(`${base}/r/test`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /og:video/);

  const media = await fetch(`${base}/media/x.mp4`, {
    headers: { Range: "bytes=0-99" },
    signal: AbortSignal.timeout(10_000),
  });

  assert.equal(media.status, 206);
  assert.match(media.headers.get("content-range") ?? "", /^bytes 0-99\/\d+$/);
  assert.equal((await media.arrayBuffer()).byteLength, 100);

  for (const path of ["/api/spike/comfy", "/api/spike/status"]) {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 404, `${path} must be disabled by default`);
    await response.body?.cancel();
  }

  docker("exec", name, "ffmpeg", "-version");
  docker("exec", name, "ffprobe", "-version");
  docker("exec", name, "test", "!", "-e", "/app/docs/priv");

  const browserTests = spawnSync("npm", ["run", "test:e2e"], {
    env: { ...process.env, BASE_URL: base, WAN_TEST_JOB_ID: "" },
    stdio: "inherit",
    timeout: 120_000,
  });

  assert.equal(browserTests.status, 0, "Container browser tests failed");
  console.log("Container health, SSR, byte ranges, diagnostics, FFmpeg and browser checks passed.");
} catch (error) {
  if (created) {
    console.error(docker("logs", name));
  }

  throw error;
} finally {
  if (created) {
    docker("rm", "--force", "--volumes", name);
  }
}
