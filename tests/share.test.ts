import assert from "node:assert/strict";

import "./temp-database.ts";
import { copyFile, stat } from "node:fs/promises";
import test from "node:test";

import { listSampleCharacters } from "../src/features/motionTransfer/server/characters.server.ts";
import { readResult } from "../src/features/motionTransfer/server/generate.ts";
import {
  createGeneration,
  findGeneration,
  markQueued,
  transition,
} from "../src/features/motionTransfer/server/generations.ts";
import { isPublicRequest } from "../src/features/motionTransfer/server/public-access.ts";
import { readShare } from "../src/features/motionTransfer/server/share.ts";
import { workflowModelFiles } from "../src/features/motionTransfer/workflows/models.ts";
import { motionTransferWorkflow } from "../src/features/motionTransfer/workflows/registry.ts";
import { hashFile, incomingPath, storeAsset } from "../src/shared/server/assets.ts";
import { database } from "../src/shared/server/db.server.ts";

/** Stores a committed file as an asset of `kind`. */
async function store(file: string, kind: "image" | "poster" | "video") {
  const temporary = await incomingPath();
  await copyFile(file, temporary);

  const { asset } = await storeAsset(temporary, {
    bytes: (await stat(temporary)).size,
    duration_ms: null,
    ext: kind === "video" ? "mp4" : kind === "poster" ? "jpg" : "png",
    fps: null,
    has_audio: null,
    height: null,
    kind,
    mime: kind === "video" ? "video/mp4" : kind === "poster" ? "image/jpeg" : "image/png",
    role: kind === "poster" ? "poster" : "upload",
    sha256: await hashFile(temporary),
    source_asset_id: null,
    width: null,
  });

  return asset;
}

const source = await store("fixtures/x.mp4", "video");
const otherSource = await store("tests/fixtures/long-12s.mp4", "video");
const characterImage = await store("fixtures/wan/reference.png", "image");
const result = await store("tests/fixtures/result-5s.mp4", "video");
const poster = await store("tests/fixtures/result-poster.jpg", "poster");

/** A queued generation of `drivingVideo` and the character image, as `generate` records one. */
function queued(drivingVideo: { sha256: string }, seed: number) {
  const { id } = createGeneration({
    recipe: {
      inputs: {
        driving_video_sha256: drivingVideo.sha256,
        reference_image_sha256: characterImage.sha256,
      },
      models: [],
      params: { fragment_length: 81, height: 848, prompt: "A dancer", seed, width: 480 },
      target: "cloud",
      workflow: { id: "motion-transfer", sha256: motionTransferWorkflow.sha256, version: 1 },
    },
  });

  return markQueued(id, `job-${id}`);
}

/** A generation of `source` that is done, with `result` and `poster`. */
function done(seed: number) {
  const { id } = queued(source, seed);
  transition(id, "queued", "finalizing");

  return transition(id, "finalizing", "done", {
    final_asset_id: result.id,
    poster_asset_id: poster.id,
  });
}

test("a generation gets an unguessable share slug when it becomes done, and only then", () => {
  const { id } = queued(source, 1);

  assert.equal(findGeneration(id)?.share_slug, null);
  assert.equal(transition(id, "queued", "finalizing").share_slug, null);

  const first = transition(id, "finalizing", "done", { final_asset_id: result.id }).share_slug;
  const second = done(2).share_slug;

  assert.match(first ?? "", /^[0-9a-f]{16}$/);
  assert.match(second ?? "", /^[0-9a-f]{16}$/);
  assert.notEqual(first, second);
});

test("only the result, poster and source clip of a shared generation open without the code", () => {
  // Before anything is done, no asset is public; share pages always are (an unknown slug is a 404).
  queued(otherSource, 3);

  for (const asset of [otherSource, characterImage]) {
    assert.equal(isPublicRequest("GET", `/media/${asset.id}.mp4`), false);
  }

  done(4);

  assert.equal(isPublicRequest("GET", "/r/anything"), true);
  assert.equal(isPublicRequest("GET", `/media/${result.id}.mp4`), true);
  assert.equal(isPublicRequest("GET", `/media/${poster.id}.jpg`), true);
  assert.equal(isPublicRequest("GET", `/media/${source.id}.mp4`), true);

  // The character photo, a clip only an unfinished generation uses, unknown ids, other routes.
  assert.equal(isPublicRequest("GET", `/media/${characterImage.id}.png`), false);
  assert.equal(isPublicRequest("GET", `/media/${otherSource.id}.mp4`), false);
  assert.equal(isPublicRequest("GET", `/media/${crypto.randomUUID()}.mp4`), false);
  assert.equal(isPublicRequest("GET", "/r/a/b"), false);
  assert.equal(isPublicRequest("GET", `/api/generations/${crypto.randomUUID()}`), false);
});

test("a share page reads its done generation with absolute media URLs; any other slug is null", async () => {
  const slug = done(5).share_slug ?? "";
  const share = readShare(slug, "https://photon.example");

  assert.equal(share?.pageUrl, `https://photon.example/r/${slug}`);
  assert.equal(share?.videoUrl, `https://photon.example/media/${result.id}.mp4`);
  assert.equal(share?.posterUrl, `https://photon.example/media/${poster.id}.jpg`);
  assert.equal(share?.source.id, source.id);
  // An uploaded clip has no sample title, and an uploaded photo is never shown.
  assert.equal(share?.motionTitle, null);
  assert.equal(share?.character, null);
  assert.deepEqual(
    share?.models,
    workflowModelFiles(motionTransferWorkflow.graph).map((file) => ({ file, license: null })),
  );

  const unfinished = queued(otherSource, 6);

  for (const other of ["0000000000000000", "does-not-exist", unfinished.id]) {
    assert.equal(readShare(other, "https://photon.example"), null);
  }
});

test("a share page names a sample character, with its public image, and never an uploaded one", () => {
  const [sample] = listSampleCharacters();
  const now = new Date().toISOString();

  const upload = database
    .prepare(
      `INSERT INTO characters (id, image_asset_id, origin, is_sample, consent_at, created_at)
      VALUES (?, ?, 'upload', 0, ?, ?) RETURNING id`,
    )
    .get(crypto.randomUUID(), characterImage.id, now, now);

  assert.ok(sample && upload);

  for (const [characterId, expected] of [
    [sample.id, sample.title],
    [String(upload.id), null],
  ] as const) {
    const { id } = createGeneration({
      characterId,
      recipe: {
        inputs: {
          driving_video_sha256: source.sha256,
          reference_image_sha256: characterImage.sha256,
        },
        models: [],
        params: { fragment_length: 81, height: 848, prompt: characterId, seed: 7, width: 480 },
        target: "cloud",
        workflow: { id: "motion-transfer", sha256: motionTransferWorkflow.sha256, version: 1 },
      },
    });

    markQueued(id, `job-${id}`);
    transition(id, "queued", "finalizing");

    const slug = transition(id, "finalizing", "done", { final_asset_id: result.id }).share_slug;

    assert.equal(
      readShare(slug ?? "", "https://photon.example")?.character?.title ?? null,
      expected,
    );
  }
});

/** A done, shared generation of `source` by `characterId`; returns its id and share slug. */
function doneBy(characterId: string, seed: number) {
  const { id } = createGeneration({
    characterId,
    recipe: {
      inputs: {
        driving_video_sha256: source.sha256,
        reference_image_sha256: characterImage.sha256,
      },
      models: [],
      params: { fragment_length: 81, height: 848, prompt: "A take", seed, width: 480 },
      target: "cloud",
      workflow: { id: "motion-transfer", sha256: motionTransferWorkflow.sha256, version: 1 },
    },
  });

  markQueued(id, `job-${id}`);
  transition(id, "queued", "finalizing");

  const { share_slug } = transition(id, "finalizing", "done", {
    final_asset_id: result.id,
    poster_asset_id: poster.id,
  });

  return { id, slug: share_slug ?? "" };
}

test("a generation's page shows an uploaded photo only with a session, and its poster as stored", () => {
  // The uploaded character an earlier test made of the (private) reference image.
  const upload = database
    .prepare("SELECT id FROM characters WHERE origin = 'upload' AND image_asset_id = ?")
    .get(characterImage.id);

  assert.ok(upload);

  const { id } = doneBy(String(upload.id), 11);

  assert.equal(readResult(id, true)?.character?.id, upload.id);
  assert.equal(readResult(id, false)?.character, null);
  assert.equal(readResult(id, true)?.poster?.id, poster.id);
});

test("a character whose image is not stored leaves the pages without it, instead of failing them", () => {
  const now = new Date().toISOString();

  // Only a database that once ran without its foreign keys can hold such a row.
  database.exec("PRAGMA foreign_keys = OFF");

  const orphan = database
    .prepare(
      `INSERT INTO characters (id, title, image_asset_id, origin, is_sample, created_at)
      VALUES (?, 'Orphan', ?, 'generated', 0, ?) RETURNING id`,
    )
    .get(crypto.randomUUID(), crypto.randomUUID(), now);

  database.exec("PRAGMA foreign_keys = ON");

  const { id, slug } = doneBy(String(orphan?.id), 12);

  assert.equal(readResult(id, true)?.character, null);
  assert.equal(readShare(slug, "https://photon.example")?.character, null);
  assert.equal(readShare(slug, "https://photon.example")?.final.id, result.id);
});
