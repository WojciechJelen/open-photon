import assert from "node:assert/strict";
import test from "node:test";

import { byteRange, serveMedia } from "../src/server/media.server.ts";

test("range parser covers bounded, open, suffix and unsatisfiable ranges", () => {
  assert.deepEqual(byteRange("bytes=0-99", 1000), { end: 99, start: 0 });
  assert.deepEqual(byteRange("bytes=900-", 1000), { end: 999, start: 900 });
  assert.deepEqual(byteRange("bytes=-100", 1000), { end: 999, start: 900 });
  assert.equal(byteRange("bytes=1000-", 1000), null);
  assert.equal(byteRange("bytes=10-1", 1000), null);
  assert.equal(byteRange("bytes=-0", 1000), null);
  assert.equal(byteRange("bytes=0-1,4-5", 1000), null);
});

test("GET and HEAD serve a real fixture with accurate range headers", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await serveMedia(
      new Request("http://localhost/media/x.mp4", {
        headers: { Range: "bytes=0-99" },
        method,
      }),
      "x.mp4",
    );

    assert.equal(response.status, 206);
    assert.match(response.headers.get("content-range") ?? "", /^bytes 0-99\/[0-9]+$/);
    assert.equal(response.headers.get("content-length"), "100");
    assert.equal((await response.arrayBuffer()).byteLength, method === "HEAD" ? 0 : 100);
  }

  const invalid = await serveMedia(
    new Request("http://localhost/media/x.mp4", {
      headers: { Range: "bytes=999999999-" },
    }),
    "x.mp4",
  );

  assert.equal(invalid.status, 416);
});
