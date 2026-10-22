import assert from "node:assert/strict";
import test from "node:test";

import { resolveComfyTarget } from "../src/shared/server/comfy-target.ts";

const key = "test-key-not-a-real-key";

test("an unset or blank base URL is Comfy Cloud, which needs a key", () => {
  assert.deepEqual(resolveComfyTarget({ COMFY_API_KEY: key }), {
    apiKey: key,
    baseUrl: "https://cloud.comfy.org",
    kind: "cloud",
  });
  assert.equal(resolveComfyTarget({ COMFY_API_KEY: key, COMFY_BASE_URL: "  " }).kind, "cloud");

  for (const env of [{}, { COMFY_API_KEY: "" }, { COMFY_API_KEY: "  ", COMFY_BASE_URL: "" }]) {
    assert.throws(() => resolveComfyTarget(env), /COMFY_API_KEY.*Comfy Cloud.*COMFY_BASE_URL/);
  }
});

test("Comfy Cloud is the same origin and path, however it is written", () => {
  assert.deepEqual(
    resolveComfyTarget({ COMFY_API_KEY: key, COMFY_BASE_URL: "https://cloud.comfy.org:443/" }),
    { apiKey: key, baseUrl: "https://cloud.comfy.org:443", kind: "cloud" },
  );
  assert.equal(
    resolveComfyTarget({
      COMFY_API_KEY: key,
      COMFY_BASE_URL: "https://cloud.comfy.org/self-hosted",
    }).kind,
    "selfhost",
  );
});

test("any other deployment is self-hosted, with an optional key and no trailing slash", () => {
  assert.deepEqual(
    resolveComfyTarget({ COMFY_API_KEY: " ", COMFY_BASE_URL: "http://host:8189/" }),
    {
      apiKey: undefined,
      baseUrl: "http://host:8189",
      kind: "selfhost",
    },
  );
  assert.deepEqual(resolveComfyTarget({ COMFY_API_KEY: key, COMFY_BASE_URL: "http://host:8189" }), {
    apiKey: key,
    baseUrl: "http://host:8189",
    kind: "selfhost",
  });
});

test("a base URL that is not plain http(s) is refused, without echoing the key", () => {
  for (const url of ["ftp://host", "http://x?y", "http://x#f", "http://x?", "not a url"]) {
    // Names the variable; the lookahead fails if the key appears anywhere in the message.
    assert.throws(
      () => resolveComfyTarget({ COMFY_API_KEY: key, COMFY_BASE_URL: url }),
      new RegExp(`^(?![\\s\\S]*${key})[\\s\\S]*COMFY_BASE_URL`),
    );
  }
});
