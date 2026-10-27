import { randomInt } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import {
  SCENES_OUTPUT,
  STORYBOARD_SCENES_WORKFLOW,
  type StoryboardScenesInput,
  storyboardScenesInputSchema,
} from "../contracts.ts";

const WORKFLOW_VERSION = 1;

const TEXT_MODEL_LOADER = "1";
const TEXT_GENERATE = "3";
const SAVE_TEXT = "4";

// Below 2^48, the largest range `randomInt` draws from, as the service's retries draw.
const SEED_RANGE = 2 ** 48 - 1;

/**
 * `storyboard-scenes.v1.json` (Qwen3.5 4B through core `TextGenerate`, `workflows/README.md`) with
 * its inputs map and model pins, read once when the server starts from the working directory.
 */
const scenesWorkflow = loadRuntimeWorkflow(
  resolve("src/features/storyboard/workflows/storyboard-scenes.v1.json"),
  ["request", "seed"],
);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const seedSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * The text model as the workflow file runs it: the loader's inputs and every `TextGenerate`
 * literal (system prompt and sampling settings) but the request and the seed the recipe binds.
 * Read from the graph, so a recipe records exactly what its workflow file (whose SHA-256 it also
 * records) sends.
 */
const textModelSchema = z.strictObject({
  loader: z.record(z.string(), z.json()),
  settings: z.record(z.string(), z.json()),
});

function textModel() {
  const loader = scenesWorkflow.graph[TEXT_MODEL_LOADER];
  const generate = scenesWorkflow.graph[TEXT_GENERATE];

  if (loader?.class_type !== "CLIPLoader" || generate?.class_type !== "TextGenerate") {
    throw new Error("storyboard-scenes.v1: nodes 1 and 3 must be CLIPLoader and TextGenerate");
  }

  // Bound by the recipe (`request`, `seed`) or a link (`clip`), so not settings.
  const bound: readonly string[] = ["clip", "prompt", "sampling_mode.seed"];

  return textModelSchema.parse({
    loader: loader.inputs,
    settings: Object.fromEntries(
      Object.entries(generate.inputs).filter(([field]) => !bound.includes(field)),
    ),
  });
}

const recipeSchema = z.strictObject({
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  request: z.string().min(1),
  seed: seedSchema,
  target: z.enum(["cloud", "selfhost"]),
  text_model: textModelSchema,
  workflow: z.strictObject({
    id: z.literal(STORYBOARD_SCENES_WORKFLOW),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

type StoryboardScenesRecipe = z.output<typeof recipeSchema>;

/**
 * The scene split, `storyboard-scenes.v1`, for the generation service: the user's sequence, sent
 * as the request byte for byte (trimmed by the input schema), split by the text model into four
 * `Scene N:` lines, the text output `scenes` (`SaveText` `4`), which `parseScenes` reads.
 * Scalar-only, so no upload. The seed is resolved once and recorded; with sampling on, another
 * seed may give other scenes (a retry draws one).
 */
export const storyboardScenesDefinition: WorkflowDefinition<
  StoryboardScenesInput,
  StoryboardScenesRecipe
> = {
  assetInputs: () => ({}),
  buildGraph: (recipe) =>
    buildGraph(scenesWorkflow.graph, scenesWorkflow.inputsMap, {
      request: recipe.request,
      seed: recipe.seed,
    }),
  id: STORYBOARD_SCENES_WORKFLOW,
  inputSchema: storyboardScenesInputSchema,
  models: scenesWorkflow.models,
  outputs: [{ media: "text", name: SCENES_OUTPUT, nodeId: SAVE_TEXT }],
  prepareRecipe: (input, { target }) => ({
    recipe: {
      models: scenesWorkflow.models,
      request: input.sequence,
      seed: input.seed ?? randomInt(SEED_RANGE),
      target: target.kind,
      text_model: textModel(),
      workflow: {
        id: STORYBOARD_SCENES_WORKFLOW,
        sha256: scenesWorkflow.sha256,
        version: WORKFLOW_VERSION,
      },
    },
  }),
  promptOf: (recipe) => recipe.request,
  // A recipe made with another workflow file cannot be rendered again by this one.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === scenesWorkflow.sha256
      ? { ...recipe, seed, target: target.kind }
      : null,
  recipeSchema,
  seedOf: (recipe) => recipe.seed,
  version: WORKFLOW_VERSION,
  workflowHash: scenesWorkflow.sha256,
};
