import "./temp-database.ts";
import assert from "node:assert/strict";
import { copyFile, stat } from "node:fs/promises";
import test from "node:test";

import { hashFile, incomingPath, storeAsset } from "../src/server/assets.ts";
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

test("GET and HEAD serve a stored asset by id with accurate range headers", async () => {
  const temporary = await incomingPath();
  await copyFile("fixtures/x.mp4", temporary);

  const { asset } = await storeAsset(temporary, {
    bytes: (await stat(temporary)).size,
    duration_ms: null,
    ext: "mp4",
    fps: null,
    has_audio: null,
    height: null,
    kind: "video",
    mime: "video/mp4",
    role: "upload",
    sha256: await hashFile(temporary),
    source_asset_id: null,
    width: null,
  });

  for (const method of ["GET", "HEAD"]) {
    const response = await serveMedia(
      new Request(`http://localhost/media/${asset.id}.mp4`, {
        headers: { Range: "bytes=0-99" },
        method,
      }),
      `${asset.id}.mp4`,
    );

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.match(response.headers.get("content-range") ?? "", /^bytes 0-99\/[0-9]+$/);
    assert.equal(response.headers.get("content-length"), "100");
    assert.equal((await response.arrayBuffer()).byteLength, method === "HEAD" ? 0 : 100);
  }

  const invalid = await serveMedia(
    new Request(`http://localhost/media/${asset.id}.mp4`, {
      headers: { Range: "bytes=999999999-" },
    }),
    `${asset.id}.mp4`,
  );

  assert.equal(invalid.status, 416);

  for (const filename of [`${asset.id}.jpg`, `${crypto.randomUUID()}.mp4`, "x.mp4"]) {
    const missing = await serveMedia(new Request(`http://localhost/media/${filename}`), filename);
    assert.equal(missing.status, 404, filename);
  }
});
