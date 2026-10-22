import assert from "node:assert/strict";
import test from "node:test";

import { resolveComfyTarget } from "../src/shared/server/comfy-target.ts";

const key = "test-cloud-key";
const token = "test-proxy-token";

test("a Cloud key selects Cloud, including blank or explicit Cloud URLs", () => {
  for (const url of [undefined, "  ", "https://cloud.comfy.org:443///"]) {
    assert.deepEqual(resolveComfyTarget({ COMFY_API_KEY: ` ${key} `, COMFY_BASE_URL: url }), {
      apiKey: key,
      baseUrl: url?.trim() ? "https://cloud.comfy.org:443" : "https://cloud.comfy.org",
      kind: "cloud",
    });
  }
});

test("missing configuration explains both supported backends", () => {
  for (const env of [{}, { COMFY_API_KEY: "  ", COMFY_BASE_URL: "" }]) {
    assert.throws(() => resolveComfyTarget(env), /COMFY_API_KEY.*Comfy Cloud.*COMFY_BASE_URL/);
  }
});

test("a proxy URL uses only the proxy token and strips surrounding whitespace and slashes", () => {
  assert.deepEqual(
    resolveComfyTarget({
      COMFY_API_KEY: " ",
      COMFY_BASE_URL: " http://host:8189/// ",
      COMFY_PROXY_TOKEN: ` ${token} `,
    }),
    { apiKey: token, baseUrl: "http://host:8189", kind: "selfhost" },
  );
  assert.deepEqual(resolveComfyTarget({ COMFY_BASE_URL: "http://127.0.0.1:8189" }), {
    apiKey: undefined,
    baseUrl: "http://127.0.0.1:8189",
    kind: "selfhost",
  });
});

test("a Cloud key is never forwarded to a proxy, even when a proxy token is also set", () => {
  for (const url of ["http://host:8189", "https://cloud.comfy.org/self-hosted"]) {
    for (const proxyToken of [undefined, token]) {
      assert.throws(
        () =>
          resolveComfyTarget({
            COMFY_API_KEY: key,
            COMFY_BASE_URL: url,
            COMFY_PROXY_TOKEN: proxyToken,
          }),
        /COMFY_API_KEY.*cannot be combined.*COMFY_PROXY_TOKEN/,
      );
    }
  }
});

test("a proxy token cannot be used with Cloud or without a proxy URL", () => {
  for (const cloudKey of [undefined, key]) {
    assert.throws(
      () => resolveComfyTarget({ COMFY_API_KEY: cloudKey, COMFY_PROXY_TOKEN: token }),
      /COMFY_PROXY_TOKEN requires a self-hosted COMFY_BASE_URL/,
    );
  }

  assert.throws(
    () =>
      resolveComfyTarget({
        COMFY_BASE_URL: "https://cloud.comfy.org/",
        COMFY_PROXY_TOKEN: token,
      }),
    /COMFY_PROXY_TOKEN/,
  );
});

test("invalid URLs and conflicting credentials fail without exposing secrets", () => {
  for (const url of [
    "ftp://host",
    `http://x?token=${token}`,
    `http://x#${token}`,
    "http://x?",
    `http://user:${token}@host`,
    token,
    "http://proxy:8189",
  ]) {
    assert.throws(
      () =>
        resolveComfyTarget({
          COMFY_API_KEY: key,
          COMFY_BASE_URL: url,
          COMFY_PROXY_TOKEN: token,
        }),
      (error: Error) =>
        error.message.includes("COMFY_BASE_URL") &&
        !error.message.includes(key) &&
        !error.message.includes(token),
    );
  }
});
