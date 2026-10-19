import "./temp-database.ts";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";

import { database } from "../src/server/db.server.ts";
import { assetsDirectory } from "../src/server/media.server.ts";
import { MAX_UPLOAD_BYTES } from "../src/server/upload.server.ts";
import { uploadVideo } from "../src/server/videos.server.ts";

function upload(path: string) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(path)]), basename(path));

  return uploadVideo(new Request("http://localhost/api/uploads", { body: form, method: "POST" }));
}

function assetRows() {
  return database.prepare("SELECT id FROM assets WHERE role IN ('upload', 'trimmed')").all();
}

test("an upload is stored once by content hash, with its probed metadata", async () => {
  const first = await upload("fixtures/x.mp4");
  assert.equal(first.status, 201);
  const asset = await first.json();

  assert.deepEqual(
    {
      duration_ms: asset.duration_ms,
      fps: asset.fps,
      has_audio: asset.has_audio,
      height: asset.height,
      kind: asset.kind,
      mime: asset.mime,
      role: asset.role,
      width: asset.width,
    },
    {
      duration_ms: 3000,
      fps: 24,
      has_audio: false,
      height: 180,
      kind: "video",
      mime: "video/mp4",
      role: "upload",
      width: 320,
    },
  );

  const second = await upload("fixtures/x.mp4");
  assert.equal(second.status, 200);
  assert.equal((await second.json()).id, asset.id);
  assert.deepEqual(
    readdirSync(assetsDirectory()).filter(
      (name) => name.startsWith(asset.sha256) || name.endsWith(".part"),
    ),
    [`${asset.sha256}.mp4`],
  );
});

test("a file with no video is rejected and leaves nothing behind", async () => {
  const files = readdirSync(assetsDirectory());
  const rows = assetRows().length;

  for (const path of ["fixtures/wan/reference.png", "package.json"]) {
    const response = await upload(path);
    assert.equal(response.status, 422, path);
    assert.equal((await response.json()).reason, "no_video", path);
  }

  assert.deepEqual(readdirSync(assetsDirectory()), files);
  assert.equal(assetRows().length, rows);
});

test("a declared body over 128 MiB is a 413 before anything is read", async () => {
  const response = await uploadVideo(
    new Request("http://localhost/api/uploads", {
      body: "x",
      headers: {
        "Content-Length": String(MAX_UPLOAD_BYTES + 65_537),
        "Content-Type": "multipart/form-data; boundary=test",
      },
      method: "POST",
    }),
  );

  assert.equal(response.status, 413);
});
