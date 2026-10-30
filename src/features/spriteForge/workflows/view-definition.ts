import { randomInt } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { assetReferenceSchema } from "../../../shared/server/comfy-assets.ts";
import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import {
  recipeIdentitySchema,
  type WorkflowDefinition,
} from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import { getCharacter } from "../../characters/api.ts";
import {
  directionLabels,
  SPRITE_VIEW_WORKFLOW,
  type SpriteDirection,
  spriteDirectionSchema,
  type SpriteViewInput,
  spriteViewInputSchema,
  VIEW_OUTPUT,
} from "../contracts.ts";

/**
 * `sprite-view.v1.json`: the Shots & Angles graph (Qwen-Image-Edit-2511 with the Multiple-Angles
 * and 4-step Lightning LoRAs) saving under its own prefix, with its inputs map and model pins.
 * Read once when the server starts, from the working directory.
 */
const viewWorkflow = loadRuntimeWorkflow(
  resolve("src/features/spriteForge/workflows/sprite-view.v1.json"),
  ["prompt", "reference_image", "seed"],
);

/** What every recipe of this file records as the workflow that made it. */
const workflowIdentity = {
  id: SPRITE_VIEW_WORKFLOW,
  sha256: viewWorkflow.sha256,
  version: 1,
} as const;

/**
 * Each direction's prompt in the Multiple-Angles LoRA's vocabulary, as the prototype validated
 * them (`src/features/spriteForge/README.md`). The LoRA's "right" azimuths turn the character
 * towards screen-left, which is why the west directions ask for them; the sheet's facing toggle
 * covers the views where it does not.
 */
const DIRECTION_PROMPTS: Record<SpriteDirection, string> = {
  n: "<sks> back view eye-level shot medium shot",
  nw: "<sks> back-right quarter view eye-level shot medium shot",
  s: "<sks> front view eye-level shot medium shot",
  sw: "<sks> front-right quarter view eye-level shot medium shot",
  w: "<sks> right side view eye-level shot medium shot",
};

// Every recipe's identity (its target, workflow file and model pins), as the service checks it.
const identity = recipeIdentitySchema.shape;

/**
 * Everything that determines a view: the direction and its prompt, the reference image by
 * content, the seed, and its identity, strict and naming this file's id and version. The
 * character is the generation's `character_id`, not part of the recipe, so two characters with
 * the same image share their views.
 */
const recipeSchema = z.strictObject({
  ...identity,
  direction: spriteDirectionSchema,
  models: z.array(z.strictObject(identity.models.element.shape)),
  prompt: z.string().min(1),
  reference_image_sha256: identity.workflow.shape.sha256,
  seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  workflow: z.strictObject({
    ...identity.workflow.shape,
    id: z.literal(workflowIdentity.id),
    version: z.literal(workflowIdentity.version),
  }),
});

type SpriteViewRecipe = z.output<typeof recipeSchema>;

/**
 * One direction of a library character for a sprite set, `sprite-view.v1`: the character's image
 * edited by Qwen-Image-Edit-2511 into the same character seen from `direction`, one PNG (`image`,
 * `SaveImage` `2`). A set draws its five directions with one seed, drawn here when the input has
 * none. A done view stays private until its owner publishes it (`publish: "on-request"`): its
 * reference may be an uploaded photo of a real person.
 */
export const spriteViewDefinition: WorkflowDefinition<SpriteViewInput, SpriteViewRecipe> = {
  assetInputs: ({ reference_image_sha256 }) => ({ reference_image: reference_image_sha256 }),
  buildGraph: ({ prompt, seed }, { reference_image }) =>
    buildGraph(viewWorkflow.graph, viewWorkflow.inputsMap, {
      prompt,
      reference_image: assetReferenceSchema.parse(reference_image),
      seed,
    }),
  id: workflowIdentity.id,
  inputSchema: spriteViewInputSchema,
  models: viewWorkflow.models,
  outputs: [{ media: "image", name: VIEW_OUTPUT, nodeId: "2" }],
  prepareRecipe: ({ character_id, direction, seed }, { target }) => {
    // `null` too for a character whose image is no longer stored.
    const character = getCharacter(character_id);

    if (!character) {
      throw new GenerateError(404, "Character not found.");
    }

    const recipe: SpriteViewRecipe = {
      direction,
      models: viewWorkflow.models,
      prompt: DIRECTION_PROMPTS[direction],
      reference_image_sha256: character.image.sha256,
      seed: seed ?? randomInt(2 ** 48 - 1),
      target: target.kind,
      workflow: workflowIdentity,
    };

    return { characterId: character.id, recipe };
  },
  // What a character saved from a view says it is; the LoRA's trigger words mean nothing there.
  promptOf: ({ direction }) => `${directionLabels[direction]} view, made with Sprite Forge`,
  publish: "on-request",
  // Another workflow file may bind other nodes, so its recipes are not this file's to render.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === workflowIdentity.sha256
      ? { ...recipe, seed, target: target.kind }
      : null,
  recipeSchema,
  seedOf: ({ seed }) => seed,
  version: workflowIdentity.version,
  workflowHash: workflowIdentity.sha256,
};
