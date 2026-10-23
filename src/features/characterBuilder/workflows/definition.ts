import { createHash, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findGeneration, snapshot } from "../../../shared/server/generation/generations.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import {
  CAPTION_OUTPUT,
  CHARACTER_CAPTION_WORKFLOW,
  CHARACTER_GENERATION_WORKFLOW,
  type CharacterGenerationInput,
  characterGenerationInputSchema,
  IMAGE_OUTPUT,
  imageSideSchema,
} from "../contracts.ts";
import {
  characterCaptionDefinition,
  storedControls,
  storedControlsSchema,
  upsamplerSettingsSchema,
} from "./caption-definition.ts";
import { modelPinSchema, SEED_RANGE, seedSchema, sha256Schema } from "./recipe.ts";

const WORKFLOW_VERSION = 1;

/**
 * `character-generation.v1.json` (FLUX 3 Image Klein distilled, int8, `workflows/README.md`) with
 * its inputs map and model pins, read once when the server starts from the working directory,
 * like Motion Transfer's; both Dockerfiles copy every feature's `workflows/`.
 */
const imageWorkflow = loadRuntimeWorkflow(
  resolve("src/features/characterBuilder/workflows/character-generation.v1.json"),
  ["caption", "height", "seed", "width"],
);

/** `workflows/defaults.json`: the size a request without `width`/`height` renders at. */
const defaults = z
  .object({ height: imageSideSchema, note: z.string(), width: imageSideSchema })
  .parse(
    JSON.parse(
      readFileSync(resolve("src/features/characterBuilder/workflows/defaults.json"), "utf8"),
    ),
  );

/**
 * Where an enhanced caption came from, copied from its caption generation by the server: that
 * generation, its caption as the upsampler wrote it, whether the rendered caption differs from it
 * (`edited`), and the upsampler that wrote it (model, the system prompt's SHA-256, settings).
 */
const enhancementSchema = z.strictObject({
  caption: z.string(),
  edited: z.boolean(),
  generation_id: z.uuid(),
  model: z.string().min(1),
  settings: upsamplerSettingsSchema,
  system_prompt_sha256: sha256Schema,
});

/**
 * Everything that determines a character image, and nothing else: the caption byte for byte, the
 * seed and size (resolved, so a blank field never hashes differently later), where the caption
 * came from (`source`), where it renders, the workflow file and its model pins. Strict, so a stray
 * field fails instead of changing the hash silently.
 */
const recipeSchema = z.strictObject({
  caption: characterGenerationInputSchema.shape.caption,
  height: imageSideSchema,
  models: z.array(modelPinSchema),
  seed: seedSchema,
  source: z.strictObject({
    controls: storedControlsSchema,
    description: z.string().min(1).nullable(),
    enhancement: enhancementSchema.nullable(),
  }),
  target: z.enum(["cloud", "selfhost"]),
  width: imageSideSchema,
  workflow: z.strictObject({
    id: z.literal(CHARACTER_GENERATION_WORKFLOW),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

type CharacterGenerationRecipe = z.output<typeof recipeSchema>;

/**
 * The provenance of a caption enhanced by the done caption generation `id`, as the server reads it
 * from that generation's recipe and text output, never from the client: 404 `caption_not_found`
 * for no such generation, 409 `not_caption` for one of another workflow (or one without its
 * caption), 409 `caption_not_done` for one not done.
 */
function enhancedSource(id: string, caption: string): CharacterGenerationRecipe["source"] {
  const row = findGeneration(id);

  if (!row) {
    throw new GenerateError(404, "No caption enhancement has this id.", "caption_not_found");
  }

  if (
    row.workflow_id !== CHARACTER_CAPTION_WORKFLOW ||
    row.workflow_version !== characterCaptionDefinition.version
  ) {
    throw new GenerateError(409, "This generation is not a caption enhancement.", "not_caption");
  }

  if (row.status !== "done") {
    throw new GenerateError(
      409,
      `The caption enhancement is ${row.status}; use it once it is done.`,
      "caption_not_done",
    );
  }

  const recipe = characterCaptionDefinition.recipeSchema.parse(row.recipe);
  const output = snapshot(row).outputs.find(({ name }) => name === CAPTION_OUTPUT);

  if (output?.media !== "text") {
    throw new GenerateError(409, "This caption enhancement has no caption.", "not_caption");
  }

  return {
    controls: recipe.controls,
    description: recipe.description,
    enhancement: {
      caption: output.text,
      edited: caption !== output.text,
      generation_id: row.id,
      model: recipe.upsampler.model,
      settings: recipe.upsampler.settings,
      system_prompt_sha256: createHash("sha256")
        .update(recipe.upsampler.system_prompt)
        .digest("hex"),
    },
  };
}

/**
 * The character-image workflow, `character-generation.v1` (FLUX 3 Image Klein distilled), for the
 * generation service (`src/shared/server/generation/`): a caption into one PNG, the output `image`
 * (`SaveImage` `9`). The caption is stored and sent exactly as given; the graph never runs the
 * upsampler (`characterCaptionDefinition` does, as its own generation). Scalar-only: nothing is
 * uploaded. The seed is resolved once (a random one when the input has none) and the size
 * defaults to `defaults.json`'s, so the recipe holds every value the graph is built from.
 */
export const characterGenerationDefinition: WorkflowDefinition<
  CharacterGenerationInput,
  CharacterGenerationRecipe
> = {
  assetInputs: () => ({}),
  buildGraph: (recipe) =>
    buildGraph(imageWorkflow.graph, imageWorkflow.inputsMap, {
      caption: recipe.caption,
      height: recipe.height,
      seed: recipe.seed,
      width: recipe.width,
    }),
  id: CHARACTER_GENERATION_WORKFLOW,
  inputSchema: characterGenerationInputSchema,
  models: imageWorkflow.models,
  outputs: [{ media: "image", name: IMAGE_OUTPUT, nodeId: "9" }],
  prepareRecipe: (input, { target }) => ({
    recipe: {
      caption: input.caption,
      height: input.height ?? defaults.height,
      models: imageWorkflow.models,
      seed: input.seed ?? randomInt(SEED_RANGE),
      source: input.source?.caption_generation_id
        ? enhancedSource(input.source.caption_generation_id, input.caption)
        : {
            controls: storedControls(input.source?.controls),
            description: input.source?.description ?? null,
            enhancement: null,
          },
      target: target.kind,
      width: input.width ?? defaults.width,
      workflow: {
        id: CHARACTER_GENERATION_WORKFLOW,
        sha256: imageWorkflow.sha256,
        version: WORKFLOW_VERSION,
      },
    },
  }),
  promptOf: (recipe) => recipe.caption,
  // A recipe made with another workflow file cannot be rendered again by this one.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === imageWorkflow.sha256
      ? { ...recipe, seed, target: target.kind }
      : null,
  recipeSchema,
  seedOf: (recipe) => recipe.seed,
  version: WORKFLOW_VERSION,
  // The enhanced caption is the caption generation's private text output: a public share page
  // shows the rendered caption and the rest of the provenance, not that text.
  shareRecipe: ({ source, ...recipe }) => ({
    ...recipe,
    source: {
      ...source,
      enhancement: source.enhancement && {
        edited: source.enhancement.edited,
        generation_id: source.enhancement.generation_id,
        model: source.enhancement.model,
        settings: source.enhancement.settings,
        system_prompt_sha256: source.enhancement.system_prompt_sha256,
      },
    },
  }),
  workflowHash: imageWorkflow.sha256,
};
