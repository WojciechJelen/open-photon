import { randomInt } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import {
  CAPTION_OUTPUT,
  CHARACTER_CAPTION_WORKFLOW,
  type CharacterCaptionInput,
  characterCaptionInputSchema,
  type CharacterControls,
  characterStyles,
  compileCharacterRequest,
} from "../contracts.ts";
import { modelPinSchema, SEED_RANGE, seedSchema, sha256Schema } from "./recipe.ts";

const WORKFLOW_VERSION = 1;

/**
 * `character-caption.v1.json`: FLUX 3 Image Klein's prompt upsampler alone (`workflows/README.md`),
 * read once when the server starts, with its inputs map and model pins.
 */
const captionWorkflow = loadRuntimeWorkflow(
  resolve("src/features/characterBuilder/workflows/character-caption.v1.json"),
  ["request", "seed"],
);

const TEXT_GENERATE = "18:11";
const UPSAMPLER_LOADER = "18:12";
const SAVE_TEXT = "18:13";
const SYSTEM_PROMPT = "18:14";

/** A literal input of a node of the caption graph, checked against the class it must be. */
function literal(node: string, classType: string, field: string) {
  const target = captionWorkflow.graph[node];

  if (target?.class_type !== classType) {
    throw new Error(`character-caption.v1: node ${node} is not ${classType}`);
  }

  return target.inputs[field];
}

/** The upsampler's `TextGenerate` settings, but the request and the seed. */
export const upsamplerSettingsSchema = z.strictObject({
  max_length: z.int(),
  min_p: z.number(),
  mtp: z.string(),
  presence_penalty: z.number(),
  repetition_penalty: z.number(),
  sampling_mode: z.literal("on"),
  temperature: z.number(),
  thinking: z.boolean(),
  top_k: z.int(),
  top_p: z.number(),
  use_default_template: z.boolean(),
});

const upsamplerSchema = z.strictObject({
  model: z.string().min(1),
  settings: upsamplerSettingsSchema,
  system_prompt: z.string().min(1),
});

/**
 * The upsampler as the workflow file runs it: its model file, the full system prompt and every
 * `TextGenerate` setting but the request and the seed. Read from the graph, so a recipe records
 * exactly what its workflow file (whose SHA-256 it also records) sends.
 */
const upsampler = upsamplerSchema.parse({
  model: literal(UPSAMPLER_LOADER, "CLIPLoader", "clip_name"),
  settings: {
    max_length: literal(TEXT_GENERATE, "TextGenerate", "max_length"),
    min_p: literal(TEXT_GENERATE, "TextGenerate", "sampling_mode.min_p"),
    mtp: literal(TEXT_GENERATE, "TextGenerate", "mtp"),
    presence_penalty: literal(TEXT_GENERATE, "TextGenerate", "sampling_mode.presence_penalty"),
    repetition_penalty: literal(TEXT_GENERATE, "TextGenerate", "sampling_mode.repetition_penalty"),
    sampling_mode: literal(TEXT_GENERATE, "TextGenerate", "sampling_mode"),
    temperature: literal(TEXT_GENERATE, "TextGenerate", "sampling_mode.temperature"),
    thinking: literal(TEXT_GENERATE, "TextGenerate", "thinking"),
    top_k: literal(TEXT_GENERATE, "TextGenerate", "sampling_mode.top_k"),
    top_p: literal(TEXT_GENERATE, "TextGenerate", "sampling_mode.top_p"),
    use_default_template: literal(TEXT_GENERATE, "TextGenerate", "use_default_template"),
  },
  system_prompt: literal(SYSTEM_PROMPT, "PrimitiveStringMultiline", "value"),
});

/** Controls as a recipe stores them: only the ones given, or `null` for none. */
export const storedControlsSchema = z
  .strictObject({
    appearance: z.string().min(1).optional(),
    outfit: z.string().min(1).optional(),
    style: z.enum(characterStyles).optional(),
  })
  .nullable();

/** `controls` without the blank ones, or `null` when none is given. */
export function storedControls(controls: CharacterControls | undefined) {
  const given = Object.fromEntries(
    Object.entries(controls ?? {}).filter(([, value]) => value !== undefined),
  );

  return storedControlsSchema.parse(Object.keys(given).length ? given : null);
}

/**
 * Everything that determines an enhanced caption: the description and controls as given, the
 * request compiled from them, the seed, the upsampler (model, system prompt, settings), where it
 * runs, the workflow file and its model pins. Strict, so a stray field fails instead of changing
 * the hash silently.
 */
const recipeSchema = z.strictObject({
  controls: storedControlsSchema,
  description: characterCaptionInputSchema.shape.description,
  models: z.array(modelPinSchema),
  request: z.string().min(1),
  seed: seedSchema,
  target: z.enum(["cloud", "selfhost"]),
  upsampler: upsamplerSchema,
  workflow: z.strictObject({
    id: z.literal(CHARACTER_CAPTION_WORKFLOW),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

export type CharacterCaptionRecipe = z.output<typeof recipeSchema>;

/**
 * The caption enhancement, `character-caption.v1`, for the generation service: the description and
 * controls compiled into a request (`compileCharacterRequest`, recomputed here, never taken from a
 * client) and expanded by FLUX 3's prompt upsampler into one full caption, the text output
 * `caption` (`SaveText` `18:13`). Scalar-only, so no upload. The upsampler decodes greedily (top_k
 * 1, as BFL's card and Comfy's template set it), so the seed, resolved once and recorded, does not
 * change the caption: the same request gives the same caption.
 */
export const characterCaptionDefinition: WorkflowDefinition<
  CharacterCaptionInput,
  CharacterCaptionRecipe
> = {
  assetInputs: () => ({}),
  buildGraph: (recipe) =>
    buildGraph(captionWorkflow.graph, captionWorkflow.inputsMap, {
      request: recipe.request,
      seed: recipe.seed,
    }),
  id: CHARACTER_CAPTION_WORKFLOW,
  inputSchema: characterCaptionInputSchema,
  models: captionWorkflow.models,
  outputs: [{ media: "text", name: CAPTION_OUTPUT, nodeId: SAVE_TEXT }],
  prepareRecipe: (input, { target }) => ({
    recipe: {
      controls: storedControls(input.controls),
      description: input.description,
      models: captionWorkflow.models,
      request: compileCharacterRequest(input.description, input.controls),
      seed: input.seed ?? randomInt(SEED_RANGE),
      target: target.kind,
      upsampler,
      workflow: {
        id: CHARACTER_CAPTION_WORKFLOW,
        sha256: captionWorkflow.sha256,
        version: WORKFLOW_VERSION,
      },
    },
  }),
  promptOf: (recipe) => recipe.request,
  // A recipe made with another workflow file cannot be rendered again by this one.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === captionWorkflow.sha256
      ? { ...recipe, seed, target: target.kind }
      : null,
  recipeSchema,
  seedOf: (recipe) => recipe.seed,
  version: WORKFLOW_VERSION,
  workflowHash: captionWorkflow.sha256,
};
