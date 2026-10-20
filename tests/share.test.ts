import "./temp-database.ts";
import assert from "node:assert/strict";
import { copyFile, stat } from "node:fs/promises";
import test from "node:test";

import { hashFile, incomingPath, storeAsset } from "../src/server/assets.ts";
import {
  createGeneration,
  findGeneration,
  markQueued,
  transition,
} from "../src/server/generations.ts";
import { isPublicPath, readShare } from "../src/server/share.ts";
import { loadWorkflow, workflowModelFiles } from "../src/server/workflows/registry.ts";

const workflow = await loadWorkflow("motion-transfer", 1);

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
      workflow: { id: "motion-transfer", sha256: workflow.sha256, version: 1 },
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
    output_asset_id: result.id,
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
    assert.equal(isPublicPath(`/media/${asset.id}.mp4`), false);
  }

  done(4);

  assert.equal(isPublicPath("/r/anything"), true);
  assert.equal(isPublicPath(`/media/${result.id}.mp4`), true);
  assert.equal(isPublicPath(`/media/${poster.id}.jpg`), true);
  assert.equal(isPublicPath(`/media/${source.id}.mp4`), true);

  // The character photo, a clip only an unfinished generation uses, unknown ids, other routes.
  assert.equal(isPublicPath(`/media/${characterImage.id}.png`), false);
  assert.equal(isPublicPath(`/media/${otherSource.id}.mp4`), false);
  assert.equal(isPublicPath(`/media/${crypto.randomUUID()}.mp4`), false);
  assert.equal(isPublicPath("/r/a/b"), false);
  assert.equal(isPublicPath(`/api/generations/${crypto.randomUUID()}`), false);
});

test("a share page reads its done generation with absolute media URLs; any other slug is null", async () => {
  const slug = done(5).share_slug ?? "";
  const share = await readShare(slug, "https://photon.example");

  assert.equal(share?.pageUrl, `https://photon.example/r/${slug}`);
  assert.equal(share?.videoUrl, `https://photon.example/media/${result.id}.mp4`);
  assert.equal(share?.posterUrl, `https://photon.example/media/${poster.id}.jpg`);
  assert.equal(share?.source.id, source.id);
  assert.deepEqual(
    share?.models,
    workflowModelFiles(workflow.graph).map((file) => ({ file, license: null })),
  );

  const unfinished = queued(otherSource, 6);

  for (const other of ["0000000000000000", "does-not-exist", unfinished.id]) {
    assert.equal(await readShare(other, "https://photon.example"), null);
  }
});
