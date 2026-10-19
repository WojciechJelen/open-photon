import "./temp-database.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test, { after } from "node:test";

import { database } from "../src/server/db.server.ts";
import { assetsDirectory } from "../src/server/media.server.ts";
import { runTool } from "../src/server/media/probe.ts";
import { MAX_UPLOAD_BYTES } from "../src/server/upload.server.ts";
import { trimAsset, uploadVideo } from "../src/server/videos.server.ts";

function upload(path: string) {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(path)]), basename(path));

  return uploadVideo(new Request("http://localhost/api/uploads", { body: form, method: "POST" }));
}

function trim(id: string, body: { duration_ms: number; start_ms: number }) {
  return trimAsset(
    new Request(`http://localhost/api/assets/${id}/trim`, {
      body: JSON.stringify(body),
      method: "POST",
    }),
    id,
  );
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
      trimmed: asset.trimmed,
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
      trimmed: null,
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

test("a clip with no video or under 3 s is rejected and leaves nothing behind", async () => {
  const files = readdirSync(assetsDirectory());
  const rows = assetRows().length;

  for (const [path, reason] of [
    ["tests/fixtures/audio-only.m4a", "no_video"],
    ["tests/fixtures/short-2s.mp4", "too_short"],
    ["fixtures/wan/reference.png", "no_video"],
  ]) {
    const response = await upload(path ?? "");
    assert.equal(response.status, 422, path);
    assert.equal((await response.json()).reason, reason, path);
  }

  assert.deepEqual(readdirSync(assetsDirectory()), files);
  assert.equal(assetRows().length, rows);
});

test("a clip over 8 s is kept whole and comes back with its first 8 s trimmed, audio included", async () => {
  const response = await upload("tests/fixtures/long-12s.mp4");
  assert.equal(response.status, 201);
  const source = await response.json();
  assert.equal(source.duration_ms, 12_000);
  assert.equal(source.trimmed.role, "trimmed");
  assert.equal(source.trimmed.source_asset_id, source.id);
  assert.ok(source.trimmed.duration_ms >= 7900 && source.trimmed.duration_ms <= 8000);
  assert.equal(source.trimmed.has_audio, true);

  const custom = await trim(source.id, { duration_ms: 4000, start_ms: 1500 });
  assert.equal(custom.status, 201);
  const cut = await custom.json();
  assert.equal(cut.source_asset_id, source.id);
  assert.ok(cut.duration_ms >= 3900 && cut.duration_ms <= 4000);
  assert.equal(cut.has_audio, true);

  const again = await trim(source.id, { duration_ms: 4000, start_ms: 1500 });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).id, cut.id);

  assert.equal((await trim(source.id, { duration_ms: 8000, start_ms: 5000 })).status, 422);
  assert.equal((await trim(source.id, { duration_ms: 9000, start_ms: 0 })).status, 400);
  assert.equal((await trim(cut.sha256, { duration_ms: 3000, start_ms: 0 })).status, 404);
});

test("cuts of a 30000/1001 fps clip are whole frames within the range, 3 s less a frame at least", async () => {
  // One keyframe, at 0 s: every other start re-encodes. 8 s is 239.76 frames, 3 s is 89.91.
  const directory = mkdtempSync(join(tmpdir(), "open-photon-ntsc-"));
  after(() => rmSync(directory, { force: true, recursive: true }));
  const path = join(directory, "ntsc-12s.mp4");
  // prettier-ignore
  await runTool("ffmpeg", [
    "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=30000/1001",
    "-f", "lavfi", "-i", "sine=sample_rate=48000", "-t", "12",
    "-c:v", "libx264", "-g", "600", "-pix_fmt", "yuv420p", "-c:a", "aac", path,
  ]);

  const response = await upload(path);
  assert.equal(response.status, 201);
  const source = await response.json();
  assert.ok(source.trimmed.duration_ms >= 7900 && source.trimmed.duration_ms <= 8000);

  for (const [startMs, durationMs] of [
    [1500, 8000],
    [1500, 3000],
  ] as const) {
    const cut = await trim(source.id, { duration_ms: durationMs, start_ms: startMs });
    assert.equal(cut.status, 201);
    const { duration_ms: cutMs } = await cut.json();
    assert.ok(cutMs <= durationMs && cutMs >= durationMs - 34, `${durationMs}: ${cutMs} ms`);
  }

  assert.equal((await trim(source.id, { duration_ms: 2999, start_ms: 1500 })).status, 400);
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
