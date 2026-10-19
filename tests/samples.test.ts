import "./temp-database.ts";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { findAsset } from "../src/server/assets.ts";
import { database } from "../src/server/db.server.ts";
import { classifyVideo, probe } from "../src/server/media/probe.ts";
import { assetsDirectory } from "../src/server/paths.ts";
import { seedSamples } from "../src/server/samples.ts";
import { readSelection } from "../src/server/selection.ts";

function count(sql: string) {
  return Number(database.prepare(`SELECT count(*) AS count FROM ${sql}`).get()?.count);
}

test("seeding the samples again leaves the same characters and motions", () => {
  assert.equal(count("characters WHERE is_sample = 1 AND origin = 'generated'"), 3);
  assert.equal(count("motions"), 1);
  seedSamples(database);
  assert.equal(count("characters WHERE is_sample = 1 AND origin = 'generated'"), 3);
  assert.equal(count("motions"), 1);
  assert.equal(count("assets WHERE role = 'sample'"), 4);
});

test("a sample motion's clip is stored as ffprobe reads it", async () => {
  const [motion] = readSelection({}).motions;
  const stored = findAsset(motion?.clip.id ?? "");

  assert.ok(stored);

  const checked = classifyVideo(await probe(resolve(assetsDirectory(), stored.path)));

  assert.ok("file" in checked);
  assert.deepEqual(
    [stored.duration_ms, stored.fps, stored.has_audio, stored.width, stored.height, stored.mime],
    [
      checked.file.durationMs,
      checked.file.fps,
      checked.file.hasAudio,
      checked.file.width,
      checked.file.height,
      checked.file.mime,
    ],
  );
});

test("the picker resolves a motion clip and falls back to none for anything else", () => {
  const [motion] = readSelection({}).motions;
  const image = database.prepare("SELECT image_asset_id AS id FROM characters LIMIT 1").get();

  assert.equal(readSelection({ motion: motion?.clip.id }).motion?.id, motion?.clip.id);

  for (const id of [crypto.randomUUID(), String(image?.id)]) {
    assert.equal(readSelection({ motion: id }).motion, null, id);
  }
});
