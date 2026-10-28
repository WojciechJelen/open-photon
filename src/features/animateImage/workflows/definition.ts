import { randomInt } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { findAsset } from "../../../shared/server/assets.ts";
import { assetReferenceSchema } from "../../../shared/server/comfy-assets.ts";
import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import type {
  PreparedRecipe,
  WorkflowDefinition,
} from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findGeneration, readOutputs } from "../../../shared/server/generation/generations.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import { getCharacter } from "../../characters/api.ts";
import {
  ANIMATE_IMAGE_WORKFLOW,
  type AnimateImageInput,
  animateImageInputSchema,
  animationPromptSchema,
  type AnimationSource,
  animationSourceSchema,
  VIDEO_OUTPUT,
  videoSize,
} from "../contracts.ts";

const WORKFLOW_VERSION = 1;

/** Below 2^48, the largest range `randomInt` draws from, as the service's retries draw. */
const SEED_RANGE = 2 ** 48 - 1;

/**
 * `animate-image.v1.json` (Wan 2.2 14B image-to-video, fp8, with the lightx2v 4-step LoRAs;
 * `workflows/README.md`) with its inputs map and model pins, read once when the server starts
 * from the working directory (both Dockerfiles copy every feature's `workflows/`).
 */
const animateWorkflow = loadRuntimeWorkflow(
  resolve("src/features/animateImage/workflows/animate-image.v1.json"),
  ["height", "image", "prompt", "seed", "width"],
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const sideSchema = z.int().min(16).max(2048);

/**
 * Everything that determines an animation: the source image (by content, with the size it was
 * stored at) and where it came from, the prompt byte for byte, the seed and the video size
 * (resolved once), where it renders, the workflow file and its model pins. Strict, so a stray
 * field fails instead of changing the hash silently.
 */
const recipeSchema = z.strictObject({
  image: z.strictObject({
    height: z.int().positive(),
    sha256: sha256Schema,
    width: z.int().positive(),
  }),
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  params: z.strictObject({
    height: sideSchema,
    prompt: animationPromptSchema,
    seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    width: sideSchema,
  }),
  source: animationSourceSchema,
  target: z.enum(["cloud", "selfhost"]),
  workflow: z.strictObject({
    id: z.literal(ANIMATE_IMAGE_WORKFLOW),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

type AnimateImageRecipe = z.output<typeof recipeSchema>;

/** A source's stored image: its content hash and size. */
type SourceImage = { characterId?: string; height: number; sha256: string; width: number };

/** The stored image asset `id`, or the refusal for one that is missing or not a sized image. */
function storedImage(id: string, missing: string) {
  const asset = findAsset(id);

  if (asset?.kind !== "image") {
    throw new GenerateError(404, missing, "source_not_found");
  }

  if (asset.width === null || asset.height === null) {
    throw new GenerateError(
      422,
      "This image has no stored size. Upload it again.",
      "source_not_image",
    );
  }

  return { height: asset.height, sha256: asset.sha256, width: asset.width };
}

/**
 * The image `source` names, read through the shared stores (assets, the generation service's
 * outputs, the characters API), never written: 404 `source_not_found` for none, 409
 * `source_not_done` for a generation that is not done, 422 `source_not_image` for an output that
 * is not an image, 422 `consent_required` for an uploaded likeness without consent.
 */
function resolveSource(source: AnimationSource): SourceImage {
  if (source.kind === "upload") {
    return storedImage(source.asset_id, "Image not found. Upload it again.");
  }

  if (source.kind === "generation") {
    const generation = findGeneration(source.generation_id);

    if (!generation) {
      throw new GenerateError(404, "No generation has this id.", "source_not_found");
    }

    if (generation.status !== "done") {
      throw new GenerateError(
        409,
        `That generation is ${generation.status}; animate it once it is done.`,
        "source_not_done",
      );
    }

    const output = readOutputs(generation.id).find(({ name }) => name === source.output);

    if (output?.media !== "image") {
      throw new GenerateError(
        422,
        `That generation has no image output "${source.output}".`,
        "source_not_image",
      );
    }

    return storedImage(output.asset.id, "That generation's image is no longer stored.");
  }

  // `null` too for one whose image is not stored.
  const character = getCharacter(source.character_id);

  if (!character) {
    throw new GenerateError(404, "Character not found.", "source_not_found");
  }

  if (character.origin === "upload" && character.consent_at === null) {
    throw new GenerateError(
      422,
      "This character was uploaded without likeness consent.",
      "consent_required",
    );
  }

  return {
    ...storedImage(character.image.id, "This character's image is no longer stored."),
    characterId: character.id,
  };
}

/**
 * Animate Image's workflow, `animate-image.v1`, for the generation service
 * (`src/shared/server/generation/`): one still image and a description of the action into a
 * 5 s, 16 fps MP4 (81 frames) with a poster, at about 640×640 pixels in the image's aspect
 * (`videoSize`). The image is uploaded to Comfy by content (`image`); the seed is drawn once when
 * the input has none, so a recipe holds every value the graph is built from. A done video stays
 * private until its owner publishes it (`publish: "on-request"`): its source may be someone's
 * uploaded likeness or a FLUX image, whose licence asks for outputs to be reviewed before they
 * are distributed.
 */
export const animateImageDefinition: WorkflowDefinition<AnimateImageInput, AnimateImageRecipe> = {
  assetInputs: (recipe) => ({ image: recipe.image.sha256 }),
  buildGraph: (recipe, providerInputs) =>
    buildGraph(animateWorkflow.graph, animateWorkflow.inputsMap, {
      height: recipe.params.height,
      image: assetReferenceSchema.parse(providerInputs.image),
      prompt: recipe.params.prompt,
      seed: recipe.params.seed,
      width: recipe.params.width,
    }),
  id: ANIMATE_IMAGE_WORKFLOW,
  inputSchema: animateImageInputSchema,
  models: animateWorkflow.models,
  outputs: [{ media: "video", name: VIDEO_OUTPUT, nodeId: "17", poster: true }],
  prepareRecipe: (input, { target }): PreparedRecipe<AnimateImageRecipe> => {
    const { characterId, ...image } = resolveSource(input.source);

    return {
      characterId,
      recipe: {
        image,
        models: animateWorkflow.models,
        params: {
          ...videoSize(image.width, image.height),
          prompt: input.prompt,
          seed: input.seed ?? randomInt(SEED_RANGE),
        },
        source: input.source,
        target: target.kind,
        workflow: {
          id: ANIMATE_IMAGE_WORKFLOW,
          sha256: animateWorkflow.sha256,
          version: WORKFLOW_VERSION,
        },
      },
    };
  },
  promptOf: (recipe) => recipe.params.prompt,
  publish: "on-request",
  // A recipe made with another workflow file cannot be rendered again by this one.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === animateWorkflow.sha256
      ? { ...recipe, params: { ...recipe.params, seed }, target: target.kind }
      : null,
  recipeSchema,
  seedOf: (recipe) => recipe.params.seed,
  // A public share page says what kind of source was animated, not which upload, generation or
  // character it was.
  shareRecipe: ({ source, ...recipe }) => ({ ...recipe, source: { kind: source.kind } }),
  version: WORKFLOW_VERSION,
  workflowHash: animateWorkflow.sha256,
};
