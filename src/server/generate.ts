import { randomInt } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { type generateInputSchema, generationSchema, MAX_CLIP_MS } from "../lib/contracts.ts";
import { findAsset, findBySha256, type StoredAsset } from "./assets.ts";
import { findCharacter } from "./characters.server.ts";
import { comfyProvider, type Provider, providerError, providerTarget } from "./comfy.ts";
import { finalize } from "./finalize.ts";
import {
  createGeneration,
  findGeneration,
  findPending,
  findReusable,
  type Generation,
  markQueued,
  markUnknown,
  recordProviderInputs,
  transition,
} from "./generations.ts";
import { assetsDirectory } from "./paths.ts";
import { type Recipe, recipeHash } from "./recipe.ts";
import { buildGraph } from "./workflows/build-graph.ts";
import { type LoadedWorkflow, loadWorkflow } from "./workflows/registry.ts";

/** A request that cannot become a generation; `status` is the HTTP status that says why. */
export class GenerateError extends Error {
  status: 404 | 409 | 422;
  constructor(status: 404 | 409 | 422, message: string) {
    super(message);
    this.status = status;
  }
}

const UNKNOWN_MESSAGE =
  "Comfy may have accepted this generation before its job id was saved, so it is never submitted again automatically. See the README, “Generation state and recovery”.";

// Seeds stay below 2^48, the largest range `randomInt` draws from.
const SEED_RANGE = 2 ** 48 - 1;

/** Rows this process is submitting. A `preparing` row outside it was left by a stopped server. */
const submitting = new Set<string>();

type Files = { drivingVideo: StoredAsset; referenceImage: StoredAsset };

async function send(row: Generation, workflow: LoadedWorkflow, files: Files, provider: Provider) {
  let graph;

  try {
    const [driving_video, reference_image] = await Promise.all([
      provider.upload(resolve(assetsDirectory(), files.drivingVideo.path)),
      provider.upload(resolve(assetsDirectory(), files.referenceImage.path)),
    ]);

    recordProviderInputs(row.id, { driving_video, reference_image });
    graph = buildGraph(workflow.graph, workflow.inputsMap, {
      ...row.recipe.params,
      driving_video,
      reference_image,
    });
  } catch (cause) {
    const error = providerError(cause);
    console.error(JSON.stringify({ code: error.code, event: "comfy.upload-error", id: row.id }));
    transition(row.id, "preparing", "failed", {
      error_code: error.code,
      error_message: `${error.message} Nothing was submitted.`,
    });

    return;
  }

  let providerJobId;

  try {
    providerJobId = await provider.submit(graph, row.idempotency_key);
  } catch (cause) {
    const error = providerError(cause);
    console.error(JSON.stringify({ code: error.code, event: "comfy.submit-error", id: row.id }));

    if (error.refused) {
      transition(row.id, "preparing", "failed", {
        error_code: error.code,
        error_message: error.message,
      });
    } else {
      markUnknown(row.id, { error_code: error.code, error_message: UNKNOWN_MESSAGE });
    }

    return;
  }

  markQueued(row.id, providerJobId);
}

/**
 * Pipeline steps 3–6 for a recipe: a generation with the same recipe that is done or still on
 * its way is returned as is; otherwise a `preparing` row (with its idempotency key) is stored,
 * both files go to Comfy, the graph is submitted under that key, and the job id is saved the
 * moment it returns.
 */
async function submitRecipe(
  {
    characterId,
    files,
    parentId,
    recipe,
  }: {
    characterId: string | null;
    files: Files;
    parentId?: string;
    recipe: Recipe;
  },
  workflow: LoadedWorkflow,
  provider: Provider,
) {
  const hash = recipeHash(recipe);
  // No await between the lookup and the insert: one process cannot create the row twice.
  const existing = findReusable(hash) ?? findPending(hash);

  if (existing) {
    return { id: existing.id, reused: true };
  }

  const row = createGeneration({ characterId: characterId ?? undefined, parentId, recipe });
  submitting.add(row.id);

  try {
    await send(row, workflow, files, provider);
  } finally {
    submitting.delete(row.id);
  }

  return { id: row.id, reused: false };
}

/** The `generate` server function: the input contract is `generateInputSchema`. */
export async function generate(
  input: z.output<typeof generateInputSchema>,
  provider: Provider = comfyProvider,
) {
  const motion = findAsset(input.upload_asset_id);

  if (motion?.kind !== "video") {
    throw new GenerateError(404, "Motion clip not found.");
  }

  if (motion.duration_ms === null || motion.width === null || motion.height === null) {
    throw new GenerateError(422, "This clip has not been probed. Upload it again.");
  }

  if (motion.duration_ms > MAX_CLIP_MS) {
    throw new GenerateError(422, "This clip is longer than 8 seconds. Trim it first.");
  }

  const character = findCharacter(input.character_id);

  if (!character) {
    throw new GenerateError(404, "Character not found.");
  }

  if (character.origin === "upload" && character.consent_at === null) {
    throw new GenerateError(422, "This character was uploaded without likeness consent.");
  }

  const image = findAsset(character.image_asset_id);

  if (!image) {
    throw new Error(`Character ${character.id} has no image asset`);
  }

  const workflow = await loadWorkflow("motion-transfer", 1);
  const promptField = workflow.inputsMap.inputs.prompt;
  const portrait = motion.height >= motion.width;

  return submitRecipe(
    {
      characterId: character.id,
      files: { drivingVideo: motion, referenceImage: image },
      recipe: {
        inputs: { driving_video_sha256: motion.sha256, reference_image_sha256: image.sha256 },
        models: [],
        params: {
          fragment_length: 81,
          height: portrait ? 848 : 480,
          prompt:
            input.prompt ??
            z.string().parse(workflow.graph[promptField.node]?.inputs[promptField.field]),
          seed: input.seed ?? randomInt(SEED_RANGE),
          width: portrait ? 480 : 848,
        },
        target: providerTarget(),
        workflow: { id: "motion-transfer", sha256: workflow.sha256, version: 1 },
      },
    },
    workflow,
    provider,
  );
}

/**
 * `POST /api/generations/:id/retry`: a child of a failed generation (`parent_id` = `id`) with the
 * same recipe except a fresh seed, submitted like any generation. An `unknown` generation is
 * never retried: Comfy may still be rendering it (409).
 */
export async function retry(id: string, provider: Provider = comfyProvider) {
  const parent = findGeneration(id);

  if (!parent) {
    throw new GenerateError(404, "Generation not found.");
  }

  if (parent.status === "unknown") {
    throw new GenerateError(
      409,
      "Comfy may still be rendering this generation, so it is not retried. See the README, “Generation state and recovery”, then start a new generation.",
    );
  }

  if (parent.status !== "failed") {
    throw new GenerateError(
      409,
      `Only a failed generation can be retried; this one is ${parent.status}.`,
    );
  }

  const workflow = await loadWorkflow("motion-transfer", 1);
  const { recipe } = parent;

  if (
    recipe.workflow.id !== "motion-transfer" ||
    recipe.workflow.version !== 1 ||
    recipe.workflow.sha256 !== workflow.sha256
  ) {
    throw new GenerateError(409, "The workflow has changed since; start a new generation.");
  }

  const drivingVideo = findBySha256(recipe.inputs.driving_video_sha256);
  const referenceImage = findBySha256(recipe.inputs.reference_image_sha256);

  if (!drivingVideo || !referenceImage) {
    throw new Error(`Generation ${id} names input files that are not stored`);
  }

  let seed = randomInt(SEED_RANGE);

  while (seed === recipe.params.seed) {
    seed = randomInt(SEED_RANGE);
  }

  return submitRecipe(
    {
      characterId: parent.character_id,
      files: { drivingVideo, referenceImage },
      parentId: parent.id,
      recipe: { ...recipe, params: { ...recipe.params, seed } },
    },
    workflow,
    provider,
  );
}

/**
 * Settles a `preparing` row no submit in this process owns: the server stopped mid-submit. With
 * no provider inputs recorded nothing was sent, so it failed; after that the job may exist on
 * Comfy, so it becomes `unknown` and is never resubmitted.
 */
export function settleAbandoned(row: Generation) {
  if (row.status !== "preparing" || submitting.has(row.id)) {
    return row;
  }

  return row.provider_inputs === null
    ? transition(row.id, "preparing", "failed", {
        error_code: "interrupted",
        error_message: "The server stopped before sending this generation to Comfy.",
      })
    : markUnknown(row.id, { error_code: "unknown", error_message: UNKNOWN_MESSAGE });
}

/**
 * `GET /api/generations/:id`: the generation as `generationSchema`, `null` when there is none. A
 * row Comfy may have finished is finalized first, so a result the event stream missed lands here.
 */
export async function readGeneration(id: string, provider: Provider = comfyProvider) {
  const row = findGeneration(id);

  if (!row) {
    return null;
  }

  const settled = settleAbandoned(row);

  if (["queued", "running", "finalizing"].includes(settled.status)) {
    try {
      await finalize(id, provider);
    } catch (error) {
      // Comfy or the download failed; the stored row is still the truth, and the next read retries.
      console.error(
        JSON.stringify({
          event: "finalize.error",
          id,
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  }

  return generationSchema.parse(findGeneration(id) ?? settled);
}

/** A route's `:generationId` as a UUID, or the 400 response for a malformed one. */
export function generationIdParam(value: string) {
  const id = z.uuid().safeParse(value);

  return id.success ? id.data : Response.json({ error: "Invalid generation ID" }, { status: 400 });
}
