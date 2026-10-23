import "./temp-database.ts";
import assert from "node:assert/strict";
import { copyFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { seedDatabase } from "../src/app/server.ts";
import { classifyVideo } from "../src/features/motionTransfer/server/media/clip.ts";
import { readSelection, readStudio } from "../src/features/motionTransfer/server/selection.ts";
import { motionTransferDefinition } from "../src/features/motionTransfer/workflows/definition.ts";
import { motionTransferWorkflow } from "../src/features/motionTransfer/workflows/registry.ts";
import { findAsset, hashFile, incomingPath, storeAsset } from "../src/shared/server/assets.ts";
import { database } from "../src/shared/server/db.server.ts";
import {
  createGeneration,
  markQueued,
  transition,
} from "../src/shared/server/generation/generations.ts";
import { probe } from "../src/shared/server/media/probe.ts";
import { assetsDirectory } from "../src/shared/server/paths.ts";

// The rows here are Motion Transfer's, on Comfy Cloud.
const cloud = { kind: "cloud", origin: null } as const;

function count(sql: string) {
  return Number(database.prepare(`SELECT count(*) AS count FROM ${sql}`).get()?.count);
}

test("seeding the samples again leaves the same characters and motions", () => {
  assert.equal(count("characters WHERE is_sample = 1 AND origin = 'generated'"), 3);
  assert.equal(count("motions"), 1);
  seedDatabase();
  assert.equal(count("characters WHERE is_sample = 1 AND origin = 'generated'"), 3);
  assert.equal(count("motions"), 1);
  assert.equal(count("assets WHERE role = 'sample'"), 4);
});

test("a sample motion's clip is stored as ffprobe reads it", async () => {
  const [motion] = readSelection({}, true).motions;
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

test("the picker resolves a motion clip and a character, and falls back to none for anything else", async () => {
  const { characters, motions } = readSelection({}, true);
  const [motion] = motions;
  const [character] = characters;

  assert.equal(readSelection({ motion: motion?.clip.id }, true).motion?.id, motion?.clip.id);
  assert.equal(readSelection({ character: character?.id }, true).character?.id, character?.id);

  for (const id of [crypto.randomUUID(), character?.image.id ?? ""]) {
    assert.equal(readSelection({ motion: id }, true).motion, null, id);
  }

  assert.equal(readSelection({ character: motion?.clip.id }, true).character, null);
});

/** A stored copy of the 5 s result fixture, as `finalize` stores a result. */
async function storeResult() {
  const temporary = await incomingPath();

  await copyFile("tests/fixtures/result-5s.mp4", temporary);

  const { asset } = await storeAsset(temporary, {
    bytes: (await stat(temporary)).size,
    duration_ms: 5000,
    ext: "mp4",
    fps: 24,
    has_audio: true,
    height: 424,
    kind: "video",
    mime: "video/mp4",
    role: "provider_output",
    sha256: await hashFile(temporary),
    source_asset_id: null,
    width: 240,
  });

  return asset;
}

/**
 * A done generation of the sample character, pre-rendered or not, driven by the clip whose hash
 * is `drivingVideo` (the sample motion's unless a test names another).
 */
function take({
  drivingVideo,
  prerendered,
  result,
  seed,
}: {
  drivingVideo?: string;
  prerendered: boolean;
  result: string;
  seed: number;
}) {
  const { characters, motions } = readSelection({}, true);
  const [motion] = motions;
  const [character] = characters;

  assert.ok(motion && character);

  const { id } = createGeneration(motionTransferDefinition, {
    characterId: character.id,
    recipe: {
      inputs: {
        driving_video_sha256: drivingVideo ?? motion.clip.sha256,
        reference_image_sha256: character.image.sha256,
      },
      models: [],
      params: { fragment_length: 81, height: 848, prompt: "A take", seed, width: 480 },
      target: "cloud",
      workflow: { id: "motion-transfer", sha256: motionTransferWorkflow.sha256, version: 1 },
    },
    target: cloud,
  });

  markQueued(id, `job-${id}`);
  transition(id, "queued", "finalizing");
  transition(id, "finalizing", "done", { outputs: { video: result } });
  database
    .prepare("UPDATE generations SET is_prerendered = ? WHERE id = ?")
    .run(Number(prerendered), id);

  return id;
}

test("the free sample take is the newest done pre-rendered generation, and there is none before one", async () => {
  assert.equal(readStudio().sampleTake, null);
  assert.equal(readSelection({}, false).sampleTakeId, null);

  const { characters, motions } = readSelection({}, true);
  const result = await storeResult();

  // A done generation someone made is not a free sample, however recent.
  const sample = take({ prerendered: true, result: result.id, seed: 1 });

  take({ prerendered: false, result: result.id, seed: 2 });

  assert.equal(readSelection({}, false).sampleTakeId, sample);
  assert.deepEqual(readStudio().sampleTake, {
    characterTitle: characters[0]?.title,
    id: sample,
    motionTitle: motions[0]?.title,
    poster: null,
    result: readStudio().sampleTake?.result,
    source: motions[0]?.clip,
  });
  assert.equal(readStudio().sampleTake?.result.id, result.id);
});

test("a pre-rendered take whose clip is not stored is never offered, and the pages still load", async () => {
  const result = await storeResult();
  const offered = readSelection({}, false).sampleTakeId;

  // Newer than any other, but its recipe names a clip no asset has (a re-seeded sample, say).
  take({ drivingVideo: "0".repeat(64), prerendered: true, result: result.id, seed: 3 });

  assert.equal(readSelection({}, false).sampleTakeId, offered);
  assert.doesNotThrow(() => readStudio());
  assert.equal(readStudio().sampleTake?.id ?? null, offered);
});
