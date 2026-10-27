import { randomInt } from "node:crypto";

import { z } from "zod";

import { findAsset } from "../../../shared/server/assets.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { getCharacter } from "../../characters/api.ts";
import {
  IMAGE_EDIT_CAPTION_OUTPUT,
  IMAGE_EDIT_ENHANCED_WORKFLOW,
  IMAGE_EDIT_MAX_REFERENCES,
  IMAGE_EDIT_OUTPUT,
  IMAGE_EDIT_PIXELS,
  IMAGE_EDIT_SIDE,
  IMAGE_EDIT_WORKFLOW,
  type ImageEditInput,
  imageEditInputSchema,
  type ImageEditReference,
} from "../contracts.ts";
import { editGraph } from "./graph.ts";
import { imageEditEnhancedWorkflow, imageEditWorkflow, REFERENCE_PARAMS } from "./registry.ts";

const WORKFLOW_VERSION = 1;

/** Below 2^48, the largest range `randomInt` draws from, as the service's retries draw. */
const SEED_RANGE = 2 ** 48 - 1;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * One reference as a recipe stores it: the image by content (`sha256`, what is uploaded), its
 * stored size (which the default output size was resolved from) and the library character it
 * was taken from, if any.
 */
const storedReferenceSchema = z.strictObject({
  character_id: z.uuid().nullable(),
  height: z.int().positive(),
  sha256: sha256Schema,
  width: z.int().positive(),
});

type StoredReference = z.output<typeof storedReferenceSchema>;

/**
 * Everything that determines an edit, and nothing else: the prompt as trimmed, the references
 * by content in order, the resolved size and seed, the consumer's `origin` (`null` for none),
 * where it renders, the workflow file and its model pins. Strict, so a stray field fails instead
 * of changing the hash silently. One shape for both workflows; each definition's `recipeSchema`
 * also requires its own `workflow.id`.
 */
const imageEditRecipeSchema = z.strictObject({
  height: z.int(),
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  origin: imageEditInputSchema.shape.origin.unwrap().nullable(),
  prompt: z.string().min(1),
  references: z.array(storedReferenceSchema).min(1).max(IMAGE_EDIT_MAX_REFERENCES),
  seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  target: z.enum(["cloud", "selfhost"]),
  width: z.int(),
  workflow: z.strictObject({
    id: z.enum([IMAGE_EDIT_WORKFLOW, IMAGE_EDIT_ENHANCED_WORKFLOW]),
    sha256: sha256Schema,
    version: z.literal(WORKFLOW_VERSION),
  }),
});

type ImageEditRecipe = z.output<typeof imageEditRecipeSchema>;

/**
 * A reference as stored: an image asset as it is, or a library character's image (through the
 * characters API). 404 `asset_not_found`/`character_not_found`, 422 `not_image` for an asset that
 * is no image, 422 `consent_required` for an uploaded character without likeness consent.
 */
function storedReference(reference: ImageEditReference): StoredReference {
  if ("character_id" in reference) {
    // `null` too for one whose image is not stored.
    const character = getCharacter(reference.character_id);

    if (!character) {
      throw new GenerateError(404, "Character not found.", "character_not_found");
    }

    if (character.origin === "upload" && character.consent_at === null) {
      throw new GenerateError(
        422,
        "This character was uploaded without likeness consent.",
        "consent_required",
      );
    }

    return storedImage(character.image, character.id);
  }

  const asset = findAsset(reference.asset_id);

  if (!asset) {
    throw new GenerateError(404, "Reference image not found.", "asset_not_found");
  }

  return storedImage(asset, null);
}

/** A stored image asset as a reference; 422 `not_image` for another kind or one without a size. */
function storedImage(
  asset: { height: number | null; kind: string; sha256: string; width: number | null },
  characterId: string | null,
): StoredReference {
  if (asset.kind !== "image" || asset.width === null || asset.height === null) {
    throw new GenerateError(422, "A reference must be a stored image.", "not_image");
  }

  return {
    character_id: characterId,
    height: asset.height,
    sha256: asset.sha256,
    width: asset.width,
  };
}

/**
 * The size an edit without one renders at: the primary reference's aspect at about 1 MP (2^20
 * px), each side rounded down to a multiple of 16 and kept within 256–2048, so a 768×1344
 * reference renders at 768×1344, as `ReferenceMultiLatent`'s own 1 MP latent does.
 */
function referenceSize({ height, width }: StoredReference) {
  const scale = Math.sqrt(2 ** 20 / (width * height));

  const side = (length: number) =>
    Math.min(
      IMAGE_EDIT_SIDE.max,
      Math.max(
        IMAGE_EDIT_SIDE.min,
        Math.floor((length * scale) / IMAGE_EDIT_SIDE.step) * IMAGE_EDIT_SIDE.step,
      ),
    );

  return { height: side(height), width: side(width) };
}

/**
 * The two edit definitions share everything but their workflow file and outputs: `enhanced`
 * runs FLUX 3's prompt upsampler on the prompt and the references before the edit and keeps its
 * text as the private output `caption`.
 */
function editDefinition({
  enhanced,
  id,
  workflow,
}: {
  enhanced: boolean;
  id: ImageEditRecipe["workflow"]["id"];
  workflow: typeof imageEditWorkflow;
}): WorkflowDefinition<ImageEditInput, ImageEditRecipe> {
  return {
    assetInputs: ({ references }) =>
      Object.fromEntries(
        references.map(({ sha256 }, index) => [REFERENCE_PARAMS[index] ?? "", sha256]),
      ),
    buildGraph: (recipe, providerInputs) =>
      editGraph(workflow, {
        height: recipe.height,
        prompt: recipe.prompt,
        references: recipe.references.map((_, index) => {
          const reference = providerInputs[REFERENCE_PARAMS[index] ?? ""];

          if (!reference) {
            throw new Error(`${id}: reference ${index + 1} was not uploaded`);
          }

          return reference;
        }),
        seed: recipe.seed,
        width: recipe.width,
      }),
    id,
    inputSchema: imageEditInputSchema,
    models: workflow.models,
    outputs: [
      { media: "image", name: IMAGE_EDIT_OUTPUT, nodeId: "9" },
      ...(enhanced
        ? [{ media: "text" as const, name: IMAGE_EDIT_CAPTION_OUTPUT, nodeId: "53" }]
        : []),
    ],
    prepareRecipe: (given, { target }) => {
      // `submit` takes the input as the caller built it; check it here too, so a feature that
      // submits without `readInput` gets the same 422 as a request body would.
      const parsed = imageEditInputSchema.safeParse(given);

      if (!parsed.success) {
        throw new GenerateError(
          422,
          `Not a valid image edit: ${z.prettifyError(parsed.error)}`,
          "invalid_input",
        );
      }

      const input = parsed.data;

      if ((input.enhance ?? false) !== enhanced) {
        throw new GenerateError(
          422,
          `${id} ${enhanced ? "enhances" : "does not enhance"} the prompt; submit with imageEditDefinitionFor(input).`,
          "invalid_input",
        );
      }

      const references = input.references.map(storedReference);
      const [primary] = references;

      if (!primary) {
        throw new GenerateError(422, "An edit needs a reference image.", "invalid_input");
      }

      const size =
        input.width !== undefined && input.height !== undefined
          ? { height: input.height, width: input.width }
          : referenceSize(primary);

      if (
        size.width * size.height < IMAGE_EDIT_PIXELS.min ||
        size.width * size.height > IMAGE_EDIT_PIXELS.max
      ) {
        throw new GenerateError(
          422,
          `${size.width}×${size.height} is outside 0.5–1.6 megapixels.`,
          "invalid_size",
        );
      }

      return {
        characterId: primary.character_id ?? undefined,
        recipe: {
          ...size,
          models: workflow.models,
          origin: input.origin ?? null,
          prompt: input.prompt,
          references,
          seed: input.seed ?? randomInt(SEED_RANGE),
          target: target.kind,
          workflow: { id, sha256: workflow.sha256, version: WORKFLOW_VERSION },
        },
      };
    },
    // The user's prompt, never the upsampler's text (a private output).
    promptOf: (recipe) => recipe.prompt,
    // FLUX Kommunity §2.e: an edit stays private until its owner has seen and published it.
    publish: "on-request",
    // A recipe made with another workflow file cannot be rendered again by this one.
    rebase: (recipe, { seed, target }) =>
      recipe.workflow.sha256 === workflow.sha256 ? { ...recipe, seed, target: target.kind } : null,
    recipeSchema: imageEditRecipeSchema.refine(
      (recipe) => recipe.workflow.id === id,
      `Not an ${id} recipe.`,
    ),
    seedOf: (recipe) => recipe.seed,
    // The recipe holds no upsampled text (that is the private `caption` output); a consumer's
    // origin may name its own private records, so a public page shows only which feature it was.
    shareRecipe: ({ origin, ...recipe }) => ({
      ...recipe,
      origin: origin && { feature: origin.feature },
    }),
    version: WORKFLOW_VERSION,
    workflowHash: workflow.sha256,
  };
}

/**
 * `image-edit.v1`: FLUX 3 Image Klein distilled edits 1–3 reference images (`LoadImage` `11`–`13`
 * → `ReferenceMultiLatent` `17`) by the prompt as given, at the recipe's size
 * (`EmptyFlux2LatentImage` `44`), into one PNG, the output `image` (`SaveImage` `9`).
 */
export const imageEditDefinition = editDefinition({
  enhanced: false,
  id: IMAGE_EDIT_WORKFLOW,
  workflow: imageEditWorkflow,
});

/**
 * `image-edit-enhanced.v1`: the same edit after FLUX 3's prompt upsampler (`TextGenerate` `47`,
 * the template's edit system prompt, seeing the references) rewrote the prompt; its text is the
 * private output `caption` (`SaveText` `53`).
 */
export const imageEditEnhancedDefinition = editDefinition({
  enhanced: true,
  id: IMAGE_EDIT_ENHANCED_WORKFLOW,
  workflow: imageEditEnhancedWorkflow,
});
