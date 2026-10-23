import "./temp-database.ts";
import assert from "node:assert/strict";
import { copyFile, stat } from "node:fs/promises";
import test from "node:test";

import { hashFile, incomingPath, storeAsset } from "../src/shared/server/assets.ts";
import { byteRange, serveMedia } from "../src/shared/server/media.server.ts";

test("range parser: bounded, open and suffix ranges; past the end is unsatisfiable; the rest is ignored", () => {
  assert.deepEqual(byteRange("bytes=0-99", 1000), { end: 99, start: 0 });
  assert.deepEqual(byteRange("bytes=900-", 1000), { end: 999, start: 900 });
  assert.deepEqual(byteRange("bytes=-100", 1000), { end: 999, start: 900 });
  assert.deepEqual(byteRange("bytes=-5000", 1000), { end: 999, start: 0 });
  assert.deepEqual(byteRange("bytes=990-5000", 1000), { end: 999, start: 990 });
  assert.equal(byteRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(byteRange("bytes=-0", 1000), "unsatisfiable");
  assert.equal(byteRange("bytes=10-1", 1000), null);
  assert.equal(byteRange("bytes=0-1,4-5", 1000), null);
  assert.equal(byteRange("items=0-1", 1000), null);
});

async function storeVideo() {
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

  return asset;
}

/** `serveMedia` for `/media/<filename>`, as the route calls it. */
function get(filename: string, init?: RequestInit) {
  return serveMedia(new Request(`http://localhost/media/${filename}`, init), filename);
}

test("GET and HEAD serve a stored asset by id: 200, 206 for a range or suffix, 416 past the end", async () => {
  const asset = await storeVideo();
  const filename = `${asset.id}.mp4`;

  for (const method of ["GET", "HEAD"]) {
    const whole = await get(filename, { method });

    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get("content-type"), "video/mp4");
    assert.equal(whole.headers.get("content-length"), String(asset.bytes));
    assert.equal(whole.headers.get("accept-ranges"), "bytes");
    assert.equal(whole.headers.get("etag"), `"${asset.sha256}"`);
    assert.equal(whole.headers.get("cache-control"), "private, max-age=31536000, immutable");
    assert.equal((await whole.arrayBuffer()).byteLength, method === "HEAD" ? 0 : asset.bytes);

    const range = await get(filename, { headers: { Range: "bytes=0-99" }, method });

    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 0-99/${asset.bytes}`);
    assert.equal(range.headers.get("content-length"), "100");
    assert.equal((await range.arrayBuffer()).byteLength, method === "HEAD" ? 0 : 100);

    const suffix = await get(filename, { headers: { Range: "bytes=-10" }, method });

    assert.equal(suffix.status, 206);
    assert.equal(
      suffix.headers.get("content-range"),
      `bytes ${asset.bytes - 10}-${asset.bytes - 1}/${asset.bytes}`,
    );
    assert.equal(suffix.headers.get("content-length"), "10");
    assert.equal((await suffix.arrayBuffer()).byteLength, method === "HEAD" ? 0 : 10);

    const past = await get(filename, { headers: { Range: "bytes=99999999-" }, method });

    assert.equal(past.status, 416);
    assert.equal(past.headers.get("content-range"), `bytes */${asset.bytes}`);
    assert.equal((await past.arrayBuffer()).byteLength, 0);
  }

  // Several ranges are not served: the whole file instead.
  const multiple = await get(filename, { headers: { Range: "bytes=0-1,4-5" } });

  assert.equal(multiple.status, 200);
  assert.equal((await multiple.arrayBuffer()).byteLength, asset.bytes);
});

test("a matching If-None-Match is 304; If-Range keeps a range only for the same file", async () => {
  const asset = await storeVideo();
  const filename = `${asset.id}.mp4`;

  for (const tag of [`"${asset.sha256}"`, `W/"${asset.sha256}"`, `"other", "${asset.sha256}"`]) {
    const cached = await get(filename, { headers: { "If-None-Match": tag } });

    assert.equal(cached.status, 304, tag);
    assert.equal(cached.headers.get("etag"), `"${asset.sha256}"`);
    assert.equal(cached.body, null);
  }

  const changed = await get(filename, { headers: { "If-None-Match": `"${"0".repeat(64)}"` } });

  assert.equal(changed.status, 200);
  await changed.body?.cancel();

  const same = await get(filename, {
    headers: { "If-Range": `"${asset.sha256}"`, Range: "bytes=0-9" },
  });

  assert.equal(same.status, 206);
  await same.body?.cancel();

  const other = await get(filename, { headers: { "If-Range": '"other"', Range: "bytes=0-9" } });

  assert.equal(other.status, 200);
  await other.body?.cancel();
});

test("only an asset id with its own extension names a file: anything else is a 404", async () => {
  const asset = await storeVideo();

  for (const filename of [
    `${asset.id}.jpg`,
    `${crypto.randomUUID()}.mp4`,
    "x.mp4",
    asset.path,
    "../../etc/passwd",
    `../${asset.id}.mp4`,
    `${asset.id}.mp4/../../app.sqlite`,
  ]) {
    assert.equal((await get(filename)).status, 404, filename);
  }
});

test("?download=1 serves the file as an attachment with a file name, and only then", async () => {
  const asset = await storeVideo();
  const filename = `${asset.id}.mp4`;

  const download = await serveMedia(
    new Request(`http://localhost/media/${filename}?download=1`),
    filename,
  );

  assert.equal(download.status, 200);
  assert.equal(
    download.headers.get("content-disposition"),
    `attachment; filename="open-photon-${asset.id.slice(0, 8)}.mp4"`,
  );
  assert.equal(
    (await download.arrayBuffer()).byteLength,
    Number(download.headers.get("content-length")),
  );

  const inline = await serveMedia(new Request(`http://localhost/media/${filename}`), filename);

  assert.equal(inline.headers.get("content-disposition"), null);
  await inline.body?.cancel();
});

test("a generated image downloads as ai-generated-<id>; a side-by-side as open-photon-<id>-compare; a generated video and an upload as open-photon-<id>", async () => {
  const temporary = await incomingPath();
  await copyFile("tests/fixtures/fake-output.png", temporary);

  const { asset: image } = await storeAsset(temporary, {
    bytes: (await stat(temporary)).size,
    duration_ms: null,
    ext: "png",
    fps: null,
    has_audio: null,
    height: null,
    kind: "image",
    mime: "image/png",
    role: "provider_output",
    sha256: await hashFile(temporary),
    source_asset_id: null,
    width: null,
  });

  const upload = await storeVideo();
  const video = await incomingPath();
  await copyFile("tests/fixtures/fake-output.mp4", video);

  const { asset: take } = await storeAsset(video, {
    bytes: (await stat(video)).size,
    duration_ms: null,
    ext: "mp4",
    fps: null,
    has_audio: null,
    height: null,
    kind: "video",
    mime: "video/mp4",
    role: "provider_output",
    sha256: await hashFile(video),
    source_asset_id: null,
    width: null,
  });

  const stitched = await incomingPath();
  await copyFile("tests/fixtures/result-5s.mp4", stitched);

  const { asset: compare } = await storeAsset(stitched, {
    bytes: (await stat(stitched)).size,
    duration_ms: null,
    ext: "mp4",
    fps: null,
    has_audio: null,
    height: null,
    kind: "video",
    mime: "video/mp4",
    role: "final",
    sha256: await hashFile(stitched),
    source_asset_id: take.id,
    width: null,
  });

  const disposition = async (filename: string) => {
    const answer = await serveMedia(
      new Request(`http://localhost/media/${filename}?download=1`),
      filename,
    );

    await answer.body?.cancel();

    return answer.headers.get("content-disposition");
  };

  assert.equal(
    await disposition(`${image.id}.png`),
    `attachment; filename="ai-generated-${image.id.slice(0, 8)}.png"`,
  );
  assert.equal(
    await disposition(`${upload.id}.mp4`),
    `attachment; filename="open-photon-${upload.id.slice(0, 8)}.mp4"`,
  );
  assert.equal(
    await disposition(`${take.id}.mp4`),
    `attachment; filename="open-photon-${take.id.slice(0, 8)}.mp4"`,
  );
  assert.equal(
    await disposition(`${compare.id}.mp4`),
    `attachment; filename="open-photon-${compare.id.slice(0, 8)}-compare.mp4"`,
  );
});
