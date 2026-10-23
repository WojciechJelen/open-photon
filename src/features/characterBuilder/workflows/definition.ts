import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import { imageSideSchema } from "../contracts.ts";

/**
 * The FLUX.2 body of `POST /api/character-generations`, until the FLUX 3 workflow (DEV-297)
 * replaces this definition with the caption contract (`characterGenerationInputSchema` of
 * `../contracts.ts`): a text `prompt` (1–1000 characters after trimming), an optional `seed` and
 * `width`/`height`.
 */
const promptInputSchema = z.object({
  height: imageSideSchema.optional(),
  prompt: z.string().trim().min(1).max(1000),
  seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  width: imageSideSchema.optional(),
});

export type PromptInput = z.output<typeof promptInputSchema>;

const WORKFLOW_ID = "character-generation";

const WORKFLOW_VERSION = 1;

/**
 * `character-generation.v1.json` (FLUX.2 [klein] 4B distilled, `workflows/README.md`) with its
 * inputs map and model pins, read once when the server starts from the working directory, like
 * Motion Transfer's; both Dockerfiles copy every feature's `workflows/`.
 */
const characterGenerationWorkflow = loadRuntimeWorkflow(
  resolve("src/features/characterBuilder/workflows/character-generation.v1.json"),
  ["height", "prompt", "seed", "width"],
);

/** `workflows/defaults.json`: the size a request without `width`/`height` renders at. */
const defaults = z
  .object({ height: imageSideSchema, note: z.string(), width: imageSideSchema })
  .parse(
    JSON.parse(
      readFileSync(resolve("src/features/characterBuilder/workflows/defaults.json"), "utf8"),
    ),
  );

// Below 2^48, the largest range `randomInt` draws from, as the service's retries draw.
const SEED_RANGE = 2 ** 48 - 1;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Everything that determines a character image, and nothing else: the resolved params (the
 * seed and size included, so a blank field never hashes differently later), where it renders,
 * the workflow file and its model pins. Strict, so a stray field fails instead of changing the
 * hash silently.
 */
const recipeSchema = z.strictObject({
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  params: z.strictObject({
    height: imageSideSchema,
    prompt: promptInputSchema.shape.prompt,
    seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    width: imageSideSchema,
  }),
  target: z.enum(["cloud", "selfhost"]),
  workflow: z.strictObject({
    id: z.literal(WORKFLOW_ID),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

type CharacterGenerationRecipe = z.output<typeof recipeSchema>;

/**
 * The character-generation workflow, `character-generation.v1` (FLUX.2 [klein] 4B distilled),
 * for the generation service (`src/shared/server/generation/`): a text prompt into one PNG
 * portrait, the output `image` (`SaveImage` `78`). Scalar-only: nothing is uploaded, so a
 * generation has no `provider_inputs`. The seed is resolved once (a random one when the input
 * has none) and the size defaults to `defaults.json`'s, so the recipe holds every value the
 * graph is built from.
 */
export const characterGenerationDefinition: WorkflowDefinition<
  PromptInput,
  CharacterGenerationRecipe
> = {
  assetInputs: () => ({}),
  buildGraph: ({ params }) =>
    buildGraph(characterGenerationWorkflow.graph, characterGenerationWorkflow.inputsMap, params),
  id: WORKFLOW_ID,
  inputSchema: promptInputSchema,
  models: characterGenerationWorkflow.models,
  outputs: [{ media: "image", name: "image", nodeId: "78" }],
  prepareRecipe: (input, { target }) => ({
    recipe: {
      models: characterGenerationWorkflow.models,
      params: {
        height: input.height ?? defaults.height,
        prompt: input.prompt,
        seed: input.seed ?? randomInt(SEED_RANGE),
        width: input.width ?? defaults.width,
      },
      target: target.kind,
      workflow: {
        id: WORKFLOW_ID,
        sha256: characterGenerationWorkflow.sha256,
        version: WORKFLOW_VERSION,
      },
    },
  }),
  promptOf: (recipe) => recipe.params.prompt,
  // A recipe made with another workflow file cannot be rendered again by this one.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === characterGenerationWorkflow.sha256
      ? { ...recipe, params: { ...recipe.params, seed }, target: target.kind }
      : null,
  recipeSchema,
  seedOf: (recipe) => recipe.params.seed,
  version: WORKFLOW_VERSION,
  workflowHash: characterGenerationWorkflow.sha256,
};
