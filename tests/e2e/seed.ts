// Prepares the database of a Playwright run (`playwright.config.ts` runs it before the dev
// server starts). It only ever creates a database: an existing file, such as `data/app.sqlite`,
// is refused, so the tests never depend on (or touch) real generations.
import { existsSync } from "node:fs";
import { copyFile, stat } from "node:fs/promises";

import { probe } from "../../src/server/media/probe.ts";
import { loadWorkflow } from "../../src/server/workflows/registry.ts";
import { SEEDED_JOB_ID } from "./session.ts";

const path = process.env.DATABASE_PATH;

if (!path || existsSync(path)) {
  throw new Error(`The e2e seed needs DATABASE_PATH to name a new file, not ${path ?? "nothing"}`);
}

// Imported after that check, not statically: loading them opens (and migrates, and seeds) the
// database.
const { hashFile, incomingPath, storeAsset } = await import("../../src/server/assets.ts");

const { createGeneration, markQueued, transition } =
  await import("../../src/server/generations.ts");

const { readSelection } = await import("../../src/server/selection.ts");

/** Stores a committed fixture as an asset, the way `finalize` stores a result and its poster. */
async function storeFixture(
  fixture: string,
  asset: { kind: "poster" | "video"; mime: string; sourceAssetId: string | null },
) {
  const temporary = await incomingPath();
  await copyFile(fixture, temporary);

  const info = await probe(temporary);

  if (!info?.video) {
    throw new Error(`${fixture} has no picture`);
  }

  const { asset: stored } = await storeAsset(temporary, {
    bytes: (await stat(temporary)).size,
    duration_ms: asset.kind === "video" ? info.durationMs : null,
    ext: asset.kind === "video" ? "mp4" : "jpg",
    fps: asset.kind === "video" ? info.video.fps : null,
    has_audio: asset.kind === "video" ? info.hasAudio : null,
    height: info.video.height,
    kind: asset.kind,
    mime: asset.mime,
    role: asset.kind === "video" ? "provider_output" : "poster",
    sha256: await hashFile(temporary),
    source_asset_id: asset.sourceAssetId,
    width: info.video.width,
  });

  return stored;
}

// One `done` generation for `/g/:id`: the sample motion as its source, a 5 s H.264 + AAC result
// (`tests/fixtures/result-5s.mp4`) and its poster. No provider was involved.
const { characters, motions } = await readSelection({});
const clip = motions[0]?.clip;
const character = characters[0];

if (!clip || !character) {
  throw new Error("The e2e seed needs the sample motion and characters");
}

const video = await storeFixture("tests/fixtures/result-5s.mp4", {
  kind: "video",
  mime: "video/mp4",
  sourceAssetId: null,
});

const poster = await storeFixture("tests/fixtures/result-poster.jpg", {
  kind: "poster",
  mime: "image/jpeg",
  sourceAssetId: video.id,
});

const workflow = await loadWorkflow("motion-transfer", 1);

const generation = createGeneration({
  characterId: character.id,
  recipe: {
    inputs: { driving_video_sha256: clip.sha256, reference_image_sha256: character.image.sha256 },
    models: [],
    params: { fragment_length: 81, height: 848, prompt: "e2e seeded result", seed: 1, width: 480 },
    target: "cloud",
    workflow: { id: "motion-transfer", sha256: workflow.sha256, version: 1 },
  },
});

markQueued(generation.id, SEEDED_JOB_ID);

transition(generation.id, "queued", "finalizing");

transition(generation.id, "finalizing", "done", {
  final_asset_id: video.id,
  output_asset_id: video.id,
  poster_asset_id: poster.id,
});

console.log(`e2e database ${path}, done generation ${generation.id}`);
