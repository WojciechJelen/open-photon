import { randomInt } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { findAsset } from "../../../shared/server/assets.ts";
import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import {
  PRODUCT_SHOT_OUTPUT,
  PRODUCT_SHOT_WORKFLOW,
  productNameSchema,
  type ProductShotInput,
  productShotFormats,
  productShotInputSchema,
  productShotPresets,
} from "../contracts.ts";
import { layouts, shotPrompt } from "./prompts.ts";

const WORKFLOW_VERSION = 1;

/** Below 2^48, the largest range `randomInt` draws from, as the service's retries draw. */
const SEED_RANGE = 2 ** 48 - 1;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * `product-shot.v1.json` (`workflows/README.md`): BiRefNet mattes the product photo, FLUX 3 Image
 * Klein distilled paints the scene around the product with the product kept out of the noise
 * mask, and the product's own pixels are pasted back over the result. Read once at start, from
 * the working directory like every runtime workflow.
 */
const productShotWorkflow = loadRuntimeWorkflow(
  resolve("src/features/productStudio/workflows/product-shot.v1.json"),
  [
    "box_height",
    "box_width",
    "box_x",
    "box_y",
    "height",
    "product_image",
    "prompt",
    "seed",
    "width",
  ],
);

const side = z.int().positive().multipleOf(16);

/**
 * Everything that determines a product shot, and nothing else: the product photo (by its stored
 * file's SHA-256), what it is, the preset, the scene description (`null`: the preset's own), the
 * prompt they make, the format and its canvas, the seed, where it renders, the workflow file and
 * its model pins. Strict, so a stray field fails instead of changing the hash silently.
 */
const recipeSchema = z.strictObject({
  canvas: z.strictObject({
    box_height: side,
    box_width: side,
    box_x: z.int().nonnegative(),
    box_y: z.int().nonnegative(),
    height: side,
    width: side,
  }),
  description: z.string().min(1).nullable(),
  format: z.enum(productShotFormats),
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  preset: z.enum(productShotPresets),
  product: productNameSchema,
  product_image_sha256: sha256Schema,
  prompt: z.string().min(1),
  seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  target: z.enum(["cloud", "selfhost"]),
  workflow: z.strictObject({
    id: z.literal(PRODUCT_SHOT_WORKFLOW),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

type ProductShotRecipe = z.output<typeof recipeSchema>;

/**
 * Product Studio's workflow, `product-shot.v1`, for the generation service: one stored product
 * photo into one PNG (`image`, `SaveImage` `9`) of the product in a packshot, lifestyle or
 * advertising scene. The product's pixels (shape, colour, packaging, logos, label text) are the
 * photo's own; only the scene around them is generated. The photo must be a stored image; the
 * seed is drawn once when none is given. A done shot stays private until its owner publishes it
 * (`publish: "on-request"`): the FLUX Kommunity licence asks for outputs to be reviewed before
 * they are distributed.
 */
export const productShotDefinition: WorkflowDefinition<ProductShotInput, ProductShotRecipe> = {
  assetInputs: (recipe) => ({ product_image: recipe.product_image_sha256 }),
  buildGraph: (recipe, { product_image: productImage }) => {
    if (!productImage) {
      throw new Error("A product shot is built with its uploaded product photo");
    }

    return buildGraph(productShotWorkflow.graph, productShotWorkflow.inputsMap, {
      ...recipe.canvas,
      product_image: productImage,
      prompt: recipe.prompt,
      seed: recipe.seed,
    });
  },
  id: PRODUCT_SHOT_WORKFLOW,
  inputSchema: productShotInputSchema,
  models: productShotWorkflow.models,
  outputs: [{ media: "image", name: PRODUCT_SHOT_OUTPUT, nodeId: "9" }],
  prepareRecipe: (input, { target }) => {
    const photo = findAsset(input.product_asset_id);

    if (photo?.kind !== "image") {
      throw new GenerateError(404, "Product photo not found. Upload it again.", "not_found");
    }

    return {
      recipe: {
        canvas: layouts[input.format],
        description: input.description ?? null,
        format: input.format,
        models: productShotWorkflow.models,
        preset: input.preset,
        product: input.product,
        product_image_sha256: photo.sha256,
        prompt: shotPrompt(input.preset, input.product, input.description),
        seed: input.seed ?? randomInt(SEED_RANGE),
        target: target.kind,
        workflow: {
          id: PRODUCT_SHOT_WORKFLOW,
          sha256: productShotWorkflow.sha256,
          version: WORKFLOW_VERSION,
        },
      },
    };
  },
  promptOf: (recipe) => recipe.prompt,
  publish: "on-request",
  // A recipe made with another workflow file cannot be rendered again by this one.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.sha256 === productShotWorkflow.sha256
      ? { ...recipe, seed, target: target.kind }
      : null,
  recipeSchema,
  seedOf: (recipe) => recipe.seed,
  version: WORKFLOW_VERSION,
  workflowHash: productShotWorkflow.sha256,
};
