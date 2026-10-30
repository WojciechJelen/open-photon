import { randomInt } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { assetReferenceSchema } from "../../../shared/server/comfy-assets.ts";
import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findGeneration, readOutputs } from "../../../shared/server/generation/generations.ts";
import { buildGraph, type WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import {
  directionLabels,
  SHEET_OUTPUTS,
  sheetFacingSchema,
  sheetTakesSchema,
  SPRITE_SHEET_WORKFLOW,
  type SpriteDirection,
  type SpriteSheetInput,
  spriteSheetInputSchema,
  VIEW_OUTPUT,
} from "../contracts.ts";

/**
 * `sprite-sheet.v1.json` (per direction: Wan 2.2 walk clips that start and end on the view,
 * BiRefNet mattes, then the Sprite Forge custom nodes; `build_workflows.py` writes it) with its
 * inputs map and model pins. Read once when the server starts, from the working directory.
 */
const sheetWorkflow = loadRuntimeWorkflow(
  resolve("src/features/spriteForge/workflows/sprite-sheet.v1.json"),
  [
    "flip_e",
    "flip_ne",
    "flip_nw",
    "flip_se",
    "flip_sw",
    "flip_w",
    "seed_1",
    "seed_2",
    "seed_3",
    "view_n",
    "view_nw",
    "view_s",
    "view_sw",
    "view_w",
  ],
);

const WORKFLOW_VERSION = 1;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Everything that determines a sheet: each view by content, the facing of the turned views, the
 * takes per direction and the seed of the first (take `t` renders with `seed + t - 1`, hence the
 * bound), where it renders, and the workflow file with its model pins. Which generations the
 * views came from is not part of it: the same images forge the same sheet.
 */
const recipeSchema = z.strictObject({
  facing: sheetFacingSchema,
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  seed: z
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 2),
  takes: sheetTakesSchema,
  target: z.enum(["cloud", "selfhost"]),
  views: z.strictObject({
    n: sha256Schema,
    nw: sha256Schema,
    s: sha256Schema,
    sw: sha256Schema,
    w: sha256Schema,
  }),
  workflow: z.strictObject({
    id: z.literal(SPRITE_SHEET_WORKFLOW),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

type SpriteSheetRecipe = z.output<typeof recipeSchema>;

/** The `SpriteLoopCut` inputs that carry takes 2 and 3; optional, so a one-take graph drops them. */
const LATER_TAKE_INPUTS = ["frames_2", "mask_2", "frames_3", "mask_3"];

/**
 * The take a sheet graph node renders, by the graph's id rule: direction `d` owns ids
 * `d * 1000 + 1 …`, and its take-`t` nodes are `d * 1000 + t * 100 + 1 … + 99`. `0` for a shared
 * or take-independent node.
 */
function takeOf(nodeId: string) {
  const id = Number(nodeId);

  return id >= 1000 ? Math.floor((id % 1000) / 100) : 0;
}

/**
 * A copy of the sheet graph `graph` that renders one take per direction: without the take-2 and
 * take-3 nodes, and with no `SpriteLoopCut` reading them, so nothing links to a removed node.
 * `graph` is not modified.
 */
export function keepFirstTake(graph: WorkflowGraph): WorkflowGraph {
  return Object.fromEntries(
    Object.entries(graph)
      .filter(([id]) => takeOf(id) <= 1)
      .map(([id, node]) => [
        id,
        node.class_type === "SpriteLoopCut"
          ? {
              ...node,
              inputs: Object.fromEntries(
                Object.entries(node.inputs).filter(([name]) => !LATER_TAKE_INPUTS.includes(name)),
              ),
            }
          : node,
      ]),
  );
}

/**
 * The SHA-256 of the image a direction's view generation stored, read through the generation
 * service's stores: 404 `view_not_found` for an id no generation has, 409 `view_not_done` for one
 * still on its way or failed, 422 `view_not_image` for one without a stored `image` output.
 */
function viewImage(direction: SpriteDirection, generationId: string) {
  const label = directionLabels[direction];
  const generation = findGeneration(generationId);

  if (!generation) {
    throw new GenerateError(404, `The ${label} view's generation was not found.`, "view_not_found");
  }

  if (generation.status !== "done") {
    throw new GenerateError(
      409,
      `The ${label} view is ${generation.status}; forge the sheet once every view is done.`,
      "view_not_done",
    );
  }

  const output = readOutputs(generation.id).find(({ name }) => name === VIEW_OUTPUT);

  if (output?.media !== "image") {
    throw new GenerateError(422, `The ${label} view has no stored image.`, "view_not_image");
  }

  return { characterId: generation.character_id ?? undefined, sha256: output.asset.sha256 };
}

/**
 * A walk-cycle sprite sheet forged from a set's five views, `sprite-sheet.v1`: per direction one
 * or three Wan 2.2 walk clips whose first and last frame are the view, the cleanest loop cut,
 * pivot-locked and packed with the mirrored east side into an HD atlas (`hd`, `SaveImage` `911`)
 * and a pixel-art one (`pixel`, `923`), each with its Aseprite JSON (`hd-json` `912`,
 * `pixel-json` `924`). The custom nodes exist only in the self-hosted ComfyUI image, so a Comfy
 * Cloud target refuses it (422 `selfhost_required`). A done sheet stays private until its owner
 * publishes it (`publish: "on-request"`), like the views it is made of.
 */
export const spriteSheetDefinition: WorkflowDefinition<SpriteSheetInput, SpriteSheetRecipe> = {
  assetInputs: ({ views }) => ({
    view_n: views.n,
    view_nw: views.nw,
    view_s: views.s,
    view_sw: views.sw,
    view_w: views.w,
  }),
  buildGraph: ({ facing, seed, takes }, providerInputs) => {
    const view = (name: string) => assetReferenceSchema.parse(providerInputs[name]);

    // Every binding names a node of the full graph, take-2 and take-3 samplers included, so the
    // values are bound first and a one-take sheet is pruned afterwards.
    const graph = buildGraph(sheetWorkflow.graph, sheetWorkflow.inputsMap, {
      // The west rows need a character facing screen-left, the east rows (mirrors of the turned
      // views) one facing screen-right; a row flips its frames when its view faces the other way.
      flip_e: facing.w === "left",
      flip_ne: facing.nw === "left",
      flip_nw: facing.nw === "right",
      flip_se: facing.sw === "left",
      flip_sw: facing.sw === "right",
      flip_w: facing.w === "right",
      seed_1: seed,
      seed_2: seed + 1,
      seed_3: seed + 2,
      view_n: view("view_n"),
      view_nw: view("view_nw"),
      view_s: view("view_s"),
      view_sw: view("view_sw"),
      view_w: view("view_w"),
    });

    return takes === 1 ? keepFirstTake(graph) : graph;
  },
  id: SPRITE_SHEET_WORKFLOW,
  inputSchema: spriteSheetInputSchema,
  models: sheetWorkflow.models,
  outputs: [
    { media: "image", name: SHEET_OUTPUTS.hd, nodeId: "911" },
    { media: "text", name: SHEET_OUTPUTS.hdJson, nodeId: "912" },
    { media: "image", name: SHEET_OUTPUTS.pixel, nodeId: "923" },
    { media: "text", name: SHEET_OUTPUTS.pixelJson, nodeId: "924" },
  ],
  prepareRecipe: (input, { target }) => {
    if (target.kind === "cloud") {
      throw new GenerateError(
        422,
        "Sprite sheets run the Sprite Forge custom nodes, which only a self-hosted ComfyUI has. Point the app at your own GPU (COMFY_BASE_URL) to forge one.",
        "selfhost_required",
      );
    }

    const { views } = input;
    // The set's character is the front view's, as its generation recorded it.
    const front = viewImage("s", views.s);

    return {
      characterId: front.characterId,
      recipe: {
        facing: input.facing,
        models: sheetWorkflow.models,
        seed: input.seed ?? randomInt(2 ** 48 - 1),
        takes: input.takes,
        target: target.kind,
        views: {
          n: viewImage("n", views.n).sha256,
          nw: viewImage("nw", views.nw).sha256,
          s: front.sha256,
          sw: viewImage("sw", views.sw).sha256,
          w: viewImage("w", views.w).sha256,
        },
        workflow: {
          id: SPRITE_SHEET_WORKFLOW,
          sha256: sheetWorkflow.sha256,
          version: WORKFLOW_VERSION,
        },
      },
    };
  },
  promptOf: () => "Walk-cycle sprite sheet, made with Sprite Forge",
  publish: "on-request",
  // Another workflow file may wire other nodes, and the custom nodes run only on a self-hosted
  // ComfyUI, so a recipe from another file or for Comfy Cloud cannot be rendered again.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === sheetWorkflow.sha256 && target.kind !== "cloud"
      ? { ...recipe, seed, target: target.kind }
      : null,
  recipeSchema,
  seedOf: ({ seed }) => seed,
  version: WORKFLOW_VERSION,
  workflowHash: sheetWorkflow.sha256,
};
