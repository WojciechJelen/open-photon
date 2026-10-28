import { randomInt } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { assetReferenceSchema } from "../../../shared/server/comfy-assets.ts";
import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import { getCharacter } from "../../characters/api.ts";
import {
  ANGLE_VIEW_WORKFLOW,
  type AngleView,
  type AngleViewInput,
  angleViewInputSchema,
  angleViewSchema,
  VIEW_OUTPUT,
  viewLabels,
} from "../contracts.ts";

const WORKFLOW_VERSION = 1;

/** Below 2^48, the largest range `randomInt` draws from, as the service's retries draw. */
const SEED_RANGE = 2 ** 48 - 1;

/**
 * `angle-view.v1.json` (Qwen-Image-Edit-2511 bf16 with the fal Multiple-Angles LoRA and the
 * lightx2v 4-step Lightning LoRA, `workflows/README.md`) with its inputs map and model pins.
 * Read once when the server starts, from the working directory.
 */
const angleViewWorkflow = loadRuntimeWorkflow(
  resolve("src/features/angles/workflows/angle-view.v1.json"),
  ["prompt", "reference_image", "seed"],
);

/**
 * The prompt of each view, in the Multiple-Angles LoRA's own vocabulary (`<sks> <azimuth>
 * <elevation> <distance>`), as measured in `docs/feature-evidence/shots-and-angles/`. "medium
 * shot" keeps a full-body reference full body; the LoRA picks which side a turn shows.
 */
const VIEW_PROMPTS: Record<AngleView, string> = {
  "close-up": "<sks> front view eye-level shot close-up",
  front: "<sks> front view eye-level shot medium shot",
  profile: "<sks> right side view eye-level shot medium shot",
  "three-quarter": "<sks> front-right quarter view eye-level shot medium shot",
};

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Everything that determines a view, and nothing else: the reference image (its SHA-256, the
 * file uploaded to Comfy), the view and the prompt it renders with, the seed, where it renders,
 * and the workflow file and its model pins. The character's id is the generation's
 * `character_id`, not part of the recipe: two characters with the same image are the same view.
 */
const recipeSchema = z.strictObject({
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  prompt: z.string().min(1),
  reference_image_sha256: sha256Schema,
  seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  target: z.enum(["cloud", "selfhost"]),
  view: angleViewSchema,
  workflow: z.strictObject({
    id: z.literal(ANGLE_VIEW_WORKFLOW),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

type AngleViewRecipe = z.output<typeof recipeSchema>;

/**
 * One camera angle of a library character, `angle-view.v1`, for the generation service: the
 * character's image as the reference, edited by Qwen-Image-Edit-2511 into the same character seen
 * from `view`, one PNG (`image`, `SaveImage` `2`). An uploaded character always carries its
 * likeness consent (the characters table refuses one without). The seed is resolved once (a
 * random one when the input has none). A done view stays private until its owner publishes it
 * (`publish: "on-request"`): its reference may be an uploaded photo of a real person.
 */
export const angleViewDefinition: WorkflowDefinition<AngleViewInput, AngleViewRecipe> = {
  assetInputs: (recipe) => ({ reference_image: recipe.reference_image_sha256 }),
  buildGraph: (recipe, providerInputs) =>
    buildGraph(angleViewWorkflow.graph, angleViewWorkflow.inputsMap, {
      prompt: recipe.prompt,
      reference_image: assetReferenceSchema.parse(providerInputs.reference_image),
      seed: recipe.seed,
    }),
  id: ANGLE_VIEW_WORKFLOW,
  inputSchema: angleViewInputSchema,
  models: angleViewWorkflow.models,
  outputs: [{ media: "image", name: VIEW_OUTPUT, nodeId: "2" }],
  prepareRecipe: (input, { target }) => {
    // `null` too for one whose image is not stored.
    const character = getCharacter(input.character_id);

    if (!character) {
      throw new GenerateError(404, "Character not found.");
    }

    return {
      characterId: character.id,
      recipe: {
        models: angleViewWorkflow.models,
        prompt: VIEW_PROMPTS[input.view],
        reference_image_sha256: character.image.sha256,
        seed: input.seed ?? randomInt(SEED_RANGE),
        target: target.kind,
        view: input.view,
        workflow: {
          id: ANGLE_VIEW_WORKFLOW,
          sha256: angleViewWorkflow.sha256,
          version: WORKFLOW_VERSION,
        },
      },
    };
  },
  // What a character saved from a view says it is; the LoRA's trigger words mean nothing there.
  promptOf: (recipe) => `${viewLabels[recipe.view]} view, made with Shots & Angles`,
  publish: "on-request",
  // A recipe made with another workflow file cannot be rendered again by this one.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === angleViewWorkflow.sha256
      ? { ...recipe, seed, target: target.kind }
      : null,
  recipeSchema,
  seedOf: (recipe) => recipe.seed,
  version: WORKFLOW_VERSION,
  workflowHash: angleViewWorkflow.sha256,
};
