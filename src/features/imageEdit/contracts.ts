import { z } from "zod";

/** The direct edit's workflow id: the prompt as given (`workflows/image-edit.v1.json`). */
export const IMAGE_EDIT_WORKFLOW = "image-edit";

/** The enhanced edit's workflow id: FLUX 3's prompt upsampler first (`image-edit-enhanced.v1.json`). */
export const IMAGE_EDIT_ENHANCED_WORKFLOW = "image-edit-enhanced";

/** The edited image, the one file output of either workflow (`SaveImage` `9`). */
export const IMAGE_EDIT_OUTPUT = "image";

/** The enhanced workflow's upsampled prompt: a private text output (`SaveText` `53`). */
export const IMAGE_EDIT_CAPTION_OUTPUT = "caption";

/** At most this many reference images: the graph's `LoadImage` `11`, `12`, `13`. */
export const IMAGE_EDIT_MAX_REFERENCES = 3;

/** A side of the output: a multiple of 16 (FLUX's latent step), 256–2048 px. */
export const IMAGE_EDIT_SIDE = { max: 2048, min: 256, step: 16 } as const;

/** The output's area, in ComfyUI's megapixels (2^20 px): about 0.5–1.6 MP. */
export const IMAGE_EDIT_PIXELS = { max: Math.floor(1.6 * 2 ** 20), min: 2 ** 19 } as const;

/** The largest `origin` a request may store, as JSON. */
const ORIGIN_MAX_BYTES = 4096;

const sideSchema = z
  .int()
  .min(IMAGE_EDIT_SIDE.min)
  .max(IMAGE_EDIT_SIDE.max)
  .refine((side) => side % IMAGE_EDIT_SIDE.step === 0, "A side is a multiple of 16.");

/**
 * One reference image: a stored image asset (`asset_id`: an upload of `POST /api/image-uploads`,
 * or a done generation's image output), or a library character (`character_id`), whose image is
 * the reference.
 */
const imageEditReferenceSchema = z.union([
  z.strictObject({ asset_id: z.uuid() }),
  z.strictObject({ character_id: z.uuid() }),
]);

export type ImageEditReference = z.output<typeof imageEditReferenceSchema>;

/**
 * Where an edit was asked for: the consumer feature's id and whatever JSON it keeps with the
 * recipe (a shoot, a product, a card). Part of the recipe, so it is part of what reuses a result;
 * a public share page shows only `feature`.
 */
const imageEditOriginSchema = z
  .object({ feature: z.string().trim().min(1).max(64) })
  .catchall(z.json())
  .refine(
    (origin) => new TextEncoder().encode(JSON.stringify(origin)).length <= ORIGIN_MAX_BYTES,
    `An origin is at most ${ORIGIN_MAX_BYTES} bytes of JSON.`,
  );

/**
 * A reference-image edit (FLUX 3 Image Klein distilled), as a consumer feature passes it to the
 * shared `submit`/`submitMany` with `imageEditDefinitionFor(input)` (`api.ts`):
 *
 * - `prompt`: the edit, trimmed, 1–2000 characters. Name what must stay ("keep her face, hair and
 *   outfit exactly the same") and what changes; Klein keeps the reference's pose unless told.
 * - `references`: 1–3 images; the first is the primary subject and sets the default size. Refer
 *   to several as "the first image", "the second image", ….
 * - `seed`: resolved once (random when left out); a retry draws a new one, a re-run keeps it.
 * - `width`/`height`: both or neither; multiples of 16, 256–2048 px a side, about 0.5–1.6 MP.
 *   Left out: the first reference's aspect at about 1 MP.
 * - `enhance`: FLUX 3's prompt upsampler rewrites the prompt from the images first (better for
 *   pose changes and text in the image; slower). Selects the enhanced workflow.
 * - `origin`: the consumer's provenance, stored in the recipe.
 */
export const imageEditInputSchema = z
  .strictObject({
    enhance: z.boolean().optional(),
    height: sideSchema.optional(),
    origin: imageEditOriginSchema.optional(),
    prompt: z.string().trim().min(1).max(2000),
    references: z.array(imageEditReferenceSchema).min(1).max(IMAGE_EDIT_MAX_REFERENCES),
    seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    width: sideSchema.optional(),
  })
  .superRefine(({ height, width }, context) => {
    if ((width === undefined) !== (height === undefined)) {
      context.addIssue({ code: "custom", message: "Give both width and height, or neither." });
    } else if (
      width !== undefined &&
      height !== undefined &&
      (width * height < IMAGE_EDIT_PIXELS.min || width * height > IMAGE_EDIT_PIXELS.max)
    ) {
      context.addIssue({
        code: "custom",
        message: `${width}×${height} is outside 0.5–1.6 megapixels.`,
      });
    }
  });

export type ImageEditInput = z.output<typeof imageEditInputSchema>;
