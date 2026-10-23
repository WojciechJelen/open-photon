import "./temp-database.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { seedDatabase } from "../src/app/server.ts";
import { listSampleCharacters } from "../src/features/characters/api.ts";
import { classifyVideo } from "../src/features/motionTransfer/server/media/clip.ts";
import { readSelection, readStudio } from "../src/features/motionTransfer/server/selection.ts";
import { motionTransferDefinition } from "../src/features/motionTransfer/workflows/definition.ts";
import { motionTransferWorkflow } from "../src/features/motionTransfer/workflows/registry.ts";
import { assetSchema } from "../src/shared/contracts.ts";
import { findAsset, hashFile, incomingPath, storeAsset } from "../src/shared/server/assets.ts";
import { database } from "../src/shared/server/db.server.ts";
import {
  createGeneration,
  isSharedOutput,
  markQueued,
  transition,
} from "../src/shared/server/generation/generations.ts";
import { recipeHash } from "../src/shared/server/generation/recipe-hash.ts";
import { probe } from "../src/shared/server/media/probe.ts";
import { assetsDirectory } from "../src/shared/server/paths.ts";

// The rows here are Motion Transfer's, on Comfy Cloud.
const cloud = { kind: "cloud", origin: null } as const;

function count(sql: string) {
  return Number(database.prepare(`SELECT count(*) AS count FROM ${sql}`).get()?.count);
}

const CHARACTERS_DIRECTORY = "src/features/characters/samples/characters";

test("seeding the samples again leaves the same characters and motions", () => {
  assert.equal(count("characters WHERE is_sample = 1 AND origin = 'generated'"), 6);
  assert.equal(count("motions"), 1);
  seedDatabase();
  assert.equal(count("characters WHERE is_sample = 1 AND origin = 'generated'"), 6);
  assert.equal(count("motions"), 1);
  assert.equal(count("assets WHERE role = 'sample'"), 7);
});

test("each sample character is its builder render: the manifest, its recipe file and the seeded row agree", () => {
  const { characters } = JSON.parse(readFileSync(`${CHARACTERS_DIRECTORY}/manifest.json`, "utf8"));
  const seeded = new Map(listSampleCharacters().map((character) => [character.slug, character]));

  assert.equal(seeded.size, characters.length);

  for (const sample of characters) {
    const recipe = JSON.parse(readFileSync(`${CHARACTERS_DIRECTORY}/${sample.recipe}`, "utf8"));
    const image = readFileSync(`${CHARACTERS_DIRECTORY}/${sample.image}`);
    const character = seeded.get(sample.slug);

    assert.equal(recipeHash(recipe), sample.recipe_sha256, sample.slug);
    assert.equal(createHash("sha256").update(image).digest("hex"), sample.image_sha256);
    assert.deepEqual(
      [recipe.caption, recipe.seed, recipe.models, recipe.workflow],
      [sample.caption, sample.seed, sample.provenance.models, sample.provenance.workflow],
    );
    assert.equal(recipe.workflow.id, "character-generation");
    assert.ok(recipe.models.some(({ license }: { license: string }) => license === sample.license));
    assert.doesNotMatch(sample.title, /placeholder/i);
    assert.deepEqual(
      [character?.title, character?.prompt, character?.provenance, character?.image.sha256],
      [sample.title, sample.caption, sample.provenance, sample.image_sha256],
    );
  }
});

test("seeding deletes a sample character the manifest no longer lists, and keeps a library one", () => {
  const [sample] = listSampleCharacters();

  assert.ok(sample);

  const insert = database.prepare(
    `INSERT INTO characters (id, slug, title, image_asset_id, origin, is_sample, created_at)
    VALUES (?, ?, ?, ?, 'generated', ?, ?)`,
  );

  const retired = crypto.randomUUID();
  const kept = crypto.randomUUID();

  insert.run(
    retired,
    "placeholder-blue",
    "Placeholder blue",
    sample.image.id,
    1,
    sample.created_at,
  );
  insert.run(kept, null, "Mine", sample.image.id, 0, sample.created_at);
  seedDatabase();

  assert.equal(count(`characters WHERE id = '${retired}'`), 0);
  assert.equal(count(`characters WHERE id = '${kept}'`), 1);
  assert.equal(count("characters WHERE is_sample = 1"), 6);
  database.prepare("DELETE FROM characters WHERE id = ?").run(kept);
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
 * A done generation of a character (the first sample unless `character` names another), pre-rendered
 * or not, driven by the clip whose hash is `drivingVideo` (the sample motion's unless a test names
 * another), finished at `finishedAt` when given.
 */
function take({
  character: characterId,
  drivingVideo,
  finishedAt,
  prerendered,
  result,
  seed,
}: {
  character?: string;
  drivingVideo?: string;
  finishedAt?: string;
  prerendered: boolean;
  result: string;
  seed: number;
}) {
  const { characters, motions } = readSelection({}, true);
  const [motion] = motions;
  const [character] = characters;

  assert.ok(motion && character);

  const { id } = createGeneration(motionTransferDefinition, {
    characterId: characterId ?? character.id,
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
    .prepare(
      "UPDATE generations SET is_prerendered = ?, finished_at = coalesce(?, finished_at) WHERE id = ?",
    )
    .run(Number(prerendered), finishedAt ?? null, id);

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
  assert.deepEqual(
    readStudio().wall.map(({ id }) => id),
    [offered],
  );
});

test("the result wall lists the done pre-rendered sample takes by character title, newest first within one, each with its public share page; the free take is one of them", async () => {
  const { characters, motions } = readSelection({}, true);
  const before = readStudio().wall.map(({ id }) => id);
  const result = await storeResult();
  const [first] = characters;
  const other = characters.find(({ id }) => id !== first?.id);

  assert.ok(first && other);

  const sample = take({
    finishedAt: "2099-01-01T00:00:00.000Z",
    prerendered: true,
    result: result.id,
    seed: 4,
  });

  const otherSample = take({
    character: other.id,
    finishedAt: "2098-01-01T00:00:00.000Z",
    prerendered: true,
    result: result.id,
    seed: 5,
  });

  // Newer than any, and never listed: not pre-rendered, a library character, a clip no sample
  // motion has.
  const library = crypto.randomUUID();

  database
    .prepare(
      `INSERT INTO characters (id, title, image_asset_id, origin, created_at)
      VALUES (?, 'Mine', ?, 'generated', ?)`,
    )
    .run(library, first.image.id, first.created_at);

  const later = "2100-01-01T00:00:00.000Z";

  const hidden = [
    take({ finishedAt: later, prerendered: false, result: result.id, seed: 6 }),
    take({ character: library, finishedAt: later, prerendered: true, result: result.id, seed: 7 }),
    take({
      drivingVideo: result.sha256,
      finishedAt: later,
      prerendered: true,
      result: result.id,
      seed: 8,
    }),
  ];

  const { wall } = readStudio();
  const slug = database.prepare("SELECT share_slug FROM generations WHERE id = ?").get(sample);
  const firstGroup = [sample, ...before];

  assert.deepEqual(
    wall.map(({ id }) => id),
    (first.title ?? "") < (other.title ?? "")
      ? [...firstGroup, otherSample]
      : [otherSample, ...firstGroup],
  );
  assert.ok(wall.every(({ id }) => !hidden.includes(id)));
  assert.deepEqual(
    wall.find(({ id }) => id === sample),
    {
      characterTitle: first.title,
      id: sample,
      motionTitle: motions[0]?.title,
      poster: null,
      result: assetSchema.parse(findAsset(result.id)),
      shareSlug: slug?.share_slug,
      source: motions[0]?.clip,
    },
  );
  assert.equal(wall.find(({ id }) => id === otherSample)?.characterTitle, other.title);
  // Anyone may load it: the result of a done generation with a share page.
  assert.ok(isSharedOutput(findAsset(result.id) ?? assert.fail("result not stored")));
  // The wizard's free take is the newest sample one, never a hidden one.
  assert.equal(readSelection({}, false).sampleTakeId, sample);
});
