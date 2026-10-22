// Prepares the database of a Playwright run (`playwright.config.ts` runs it before the dev
// server starts). It only ever creates a database: an existing file, such as `data/app.sqlite`,
// is refused, so the tests never depend on (or touch) real generations. It also mints the run's
// access code with `scripts/mint-code.mjs` and keeps it next to the database (`accessCode()`).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, stat, writeFile } from "node:fs/promises";

import {
  motionTransferModels,
  motionTransferWorkflow,
} from "../../src/features/motionTransfer/workflows/registry.ts";
import { comfyTarget } from "../../src/shared/server/comfy-target.ts";
import { probe } from "../../src/shared/server/media/probe.ts";
import { accessCodePath, QUEUED_JOB_ID, SEEDED_JOB_ID } from "./session.ts";

const path = process.env.DATABASE_PATH;

if (!path || existsSync(path)) {
  throw new Error(`The e2e seed needs DATABASE_PATH to name a new file, not ${path ?? "nothing"}`);
}

// Imported after that check, not statically: loading them opens (and migrates) the database.
// The samples are seeded explicitly, as the server's boot does (`src/app/boot.ts`).
const { seedDatabase } = await import("../../src/app/server.ts");

seedDatabase();

const { hashFile, incomingPath, storeAsset } = await import("../../src/shared/server/assets.ts");

const { createGeneration, markQueued, transition } =
  await import("../../src/features/motionTransfer/server/generations.ts");

const { readSelection } = await import("../../src/features/motionTransfer/server/selection.ts");

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
const { characters, motions } = readSelection({}, true);
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

/**
 * A generation of the sample motion and first character, as `generate` records one, on the target
 * the server renders on (its `COMFY_BASE_URL`), so re-running its recipe finds it.
 */
const seedGeneration = (seed: number, providerJobId: string) => {
  const { id } = createGeneration({
    characterId: character.id,
    recipe: {
      inputs: { driving_video_sha256: clip.sha256, reference_image_sha256: character.image.sha256 },
      models: motionTransferModels,
      params: { fragment_length: 81, height: 848, prompt: "e2e seeded result", seed, width: 480 },
      target: comfyTarget().kind,
      workflow: { id: "motion-transfer", sha256: motionTransferWorkflow.sha256, version: 1 },
    },
  });

  markQueued(id, providerJobId);

  return id;
};

const done = seedGeneration(1, SEEDED_JOB_ID);

transition(done, "queued", "finalizing");

transition(done, "finalizing", "done", {
  final_asset_id: video.id,
  poster_asset_id: poster.id,
});

// One generation still `queued`, for a page that follows its event stream. Comfy at the dead
// port never moves it on.
const queued = seedGeneration(2, QUEUED_JOB_ID);

const code = execFileSync(process.execPath, ["scripts/mint-code.mjs", "e2e", "1000"], {
  encoding: "utf8",
}).trim();

await writeFile(accessCodePath(path), code);

console.log(`e2e database ${path}, done generation ${done}, queued generation ${queued}`);
