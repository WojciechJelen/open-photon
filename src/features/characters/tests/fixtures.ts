// Server-side builders of the three kinds of character, for the characters feature's tests and any
// server test that needs one: an uploaded likeness, a character saved from a done image
// generation, and a seeded sample. Each test file gets its own seeded database
// (`tests/temp-database.ts`, imported first); the image generations are the test workflow's
// (`tests/test-image-workflow.ts`), stored as done without a provider.
import "../../../../tests/temp-database.ts";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { imageDefinition, imageRecipe } from "../../../../tests/test-image-workflow.ts";
import { hashFile, incomingPath, storeAsset } from "../../../shared/server/assets.ts";
import {
  createGeneration,
  markQueued,
  transition,
} from "../../../shared/server/generation/generations.ts";
import {
  createFromGeneration,
  createFromUpload,
  listSampleCharacters,
} from "../server/repository.ts";

const PNG = readFileSync("tests/fixtures/fake-output.png");

/**
 * Stores a PNG no other call stored (random bytes after `IEND`, which decoders ignore), as an
 * `upload` or a generation's `provider_output`.
 */
async function storeImage(role: "provider_output" | "upload") {
  const temporary = await incomingPath();
  const bytes = Buffer.concat([PNG, randomBytes(16)]);

  await writeFile(temporary, bytes);

  const { asset } = await storeAsset(temporary, {
    bytes: bytes.length,
    duration_ms: null,
    ext: "png",
    fps: null,
    has_audio: null,
    height: PNG.readUInt32BE(20),
    kind: "image",
    mime: "image/png",
    role,
    sha256: await hashFile(temporary),
    source_asset_id: null,
    width: PNG.readUInt32BE(16),
  });

  return asset;
}

/** A new uploaded character, with consent given now. */
export async function uploadedCharacter(title?: string) {
  const image = await storeImage("upload");

  return createFromUpload({ assetId: image.id, consentAt: new Date().toISOString(), title })
    .character;
}

// The fixture's generations are on Comfy Cloud, whatever the test's environment names.
const cloud = { kind: "cloud", origin: null } as const;

/**
 * A new generation of the test image workflow for `prompt`, stored `done` with its image output
 * `image` (no provider involved); its id. `status` stops it earlier: `queued`, or `failed`.
 */
export async function imageGeneration(
  prompt: string,
  { status = "done" }: { status?: "done" | "failed" | "queued" } = {},
) {
  const seed = randomBytes(4).readUInt32BE();

  const { id } = createGeneration(imageDefinition, {
    recipe: imageRecipe(prompt, seed, cloud),
    target: cloud,
  });

  markQueued(id, `fixture-${id}`);

  if (status === "failed") {
    transition(id, "queued", "failed", { error_code: "provider_failed" });
  } else if (status === "done") {
    const image = await storeImage("provider_output");

    transition(id, "queued", "finalizing");
    transition(id, "finalizing", "done", { outputs: { image: image.id } });
  }

  return id;
}

/** A new character saved from a done image generation of `prompt`. */
export async function generatedCharacter(
  prompt = "A painter in a yellow raincoat",
  title?: string,
) {
  const generationId = await imageGeneration(prompt);

  return createFromGeneration({ generationId, outputName: "image", title }).character;
}

/** A seeded sample character (`placeholder-blue` unless `slug` names another). */
export function sampleCharacter(slug = "placeholder-blue") {
  const sample = listSampleCharacters().find((character) => character.slug === slug);

  if (!sample) {
    throw new Error(`No sample character ${slug} is seeded`);
  }

  return sample;
}
