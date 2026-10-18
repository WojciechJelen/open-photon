import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const context = process.env.SPIKE_DOCKER_CONTEXT;
const image = process.env.SPIKE_IMAGE ?? "open-photon:latest";
const suffix = randomUUID().slice(0, 8);

const network = `comfy-sdk-${suffix}`,
  mock = `comfy-mock-${suffix}`,
  app = `comfy-sdk-app-${suffix}`;

function docker(...args) {
  const result = spawnSync("docker", [...(context ? ["--context", context] : []), ...args], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);

  return result.stdout.trim();
}

let createdNetwork = false,
  createdMock = false,
  createdApp = false;

try {
  docker("network", "create", network);
  createdNetwork = true;
  docker(
    "run",
    "-d",
    "--name",
    mock,
    "--platform",
    "linux/amd64",
    "--network",
    network,
    "--mount",
    `type=bind,source=${resolve("scripts/mock-comfy.mjs")},target=/mock.mjs,readonly`,
    image,
    "node",
    "/mock.mjs",
  );
  createdMock = true;
  docker(
    "run",
    "-d",
    "--name",
    app,
    "--platform",
    "linux/amd64",
    "--network",
    network,
    "-e",
    "ENABLE_SPIKE_CHECKS=1",
    "-e",
    `COMFY_BASE_URL=http://${mock}:9090`,
    "-e",
    "COMFY_API_KEY=spike-runtime-canary-not-a-real-key",
    "-p",
    "127.0.0.1:3031:3000",
    image,
  );
  createdApp = true;
  let response;

  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      response = await fetch("http://127.0.0.1:3031/api/spike/comfy", {
        signal: AbortSignal.timeout(5000),
      });
      break;
    } catch {
      await delay(250);
    }
  }

  assert.ok(response, "SDK test container did not start");
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, {
    httpStatus: 404,
    kind: "not-found",
    sdkError: "NotFound",
  });
  console.log(
    JSON.stringify(
      {
        productionSdk: "passed",
        realComfyAuthentication: "not-tested",
        result,
        runtimeAuthHeaderToMock: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  for (const [created, name] of [
    [createdApp, app],
    [createdMock, mock],
  ]) {
    if (created) {
      docker("stop", "--time", "1", name);
      docker("container", "rm", "--volumes", name);
    }
  }

  if (createdNetwork) {
    docker("network", "rm", network);
  }
}
