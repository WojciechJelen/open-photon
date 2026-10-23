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

/**
 * A stored copy of the 5 s result fixture (or another video `fixture`, recorded with the same
 * metadata), as `finalize` stores a result.
 */
async function storeResult(fixture = "tests/fixtures/result-5s.mp4") {
  const temporary = await incomingPath();

  await copyFile(fixture, temporary);

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
 * A done generation of a character (the first sample unless `character` names another) made from
 * its current image (unless `referenceImage` names another hash), pre-rendered or not, driven by
 * the clip whose hash is `drivingVideo` (the sample motion's unless a test names another), finished
 * at `finishedAt` when given.
 */
function take({
  character: characterId,
  drivingVideo,
  finishedAt,
  prerendered,
  referenceImage,
  result,
  seed,
}: {
  character?: string;
  drivingVideo?: string;
  finishedAt?: string;
  prerendered: boolean;
  referenceImage?: string;
  result: string;
  seed: number;
}) {
  const { characters, motions } = readSelection({}, true);
  const [motion] = motions;
  const [first] = characters;

  assert.ok(motion && first);

  const character = characterId ?? first.id;

  const image = database
    .prepare(
      `SELECT assets.sha256 FROM characters JOIN assets ON assets.id = characters.image_asset_id
      WHERE characters.id = ?`,
    )
    .get(character);

  const { id } = createGeneration(motionTransferDefinition, {
    characterId: character,
    recipe: {
      inputs: {
        driving_video_sha256: drivingVideo ?? motion.clip.sha256,
        reference_image_sha256: referenceImage ?? String(image?.sha256),
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
  // motion has, an image the sample no longer has (rendered before a re-render).
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
    take({
      finishedAt: later,
      prerendered: true,
      referenceImage: other.image.sha256,
      result: result.id,
      seed: 9,
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

test("with two sample motions the wall gives each the same number of takes, eight tiles at most with their source clips", async () => {
  const result = await storeResult();
  const clip = await storeResult("tests/fixtures/short-2s.mp4");

  // By title as SQLite orders text (binary).
  const characters = [...listSampleCharacters()].sort((a, b) =>
    (a.title ?? "") < (b.title ?? "") ? -1 : 1,
  );

  const second = crypto.randomUUID();

  database
    .prepare(
      `INSERT INTO motions (id, slug, title, source_asset_id, license, attribution, created_at)
      VALUES (?, 'zz-second', 'Zz second', ?, 'CC0-1.0', 'Test', ?)`,
    )
    .run(second, clip.id, clip.created_at);

  // Every sample × both motions, as the script leaves them.
  for (const [index, character] of characters.entries()) {
    take({ character: character.id, prerendered: true, result: result.id, seed: 100 + index });
  }

  const secondTakes = characters.map((character, index) =>
    take({
      character: character.id,
      drivingVideo: clip.sha256,
      prerendered: true,
      result: result.id,
      seed: 200 + index,
    }),
  );

  const { wall } = readStudio();
  const [motion] = readSelection({}, true).motions;

  // 8 tiles / 2 motions = 4 each: the source clip and 3 takes.
  assert.deepEqual(
    wall.map(({ motionTitle }) => motionTitle),
    [motion?.title, motion?.title, motion?.title, "Zz second", "Zz second", "Zz second"],
  );
  // The second motion's takes are its first three characters by title.
  assert.deepEqual(
    wall.filter(({ source }) => source.id === clip.id).map(({ id }) => id),
    secondTakes.slice(0, 3),
  );
  database.prepare("DELETE FROM motions WHERE id = ?").run(second);
});
