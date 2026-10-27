import { z } from "zod";

/** The workflow id of an animation (`animate-image.v1`, Wan 2.2 14B image-to-video). */
export const ANIMATE_IMAGE_WORKFLOW = "animate-image";

/** The one MP4 an animation stores; its still is the shared `poster` output. */
export const VIDEO_OUTPUT = "video";

/** The output a link from another feature names when it leaves `output` out. */
const DEFAULT_SOURCE_OUTPUT = "image";

/** A generation output's name (`image`, `image-2`, …), as `OutputDeclaration` names it. */
const outputNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

/**
 * The still image an animation starts from: an uploaded image (`POST /api/image-uploads`, its
 * asset id), an image output of a done generation of any workflow (its id and output name), or a
 * library character (its reference image).
 */
export const animationSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ asset_id: z.uuid(), kind: z.literal("upload") }),
  z.strictObject({
    generation_id: z.uuid(),
    kind: z.literal("generation"),
    output: outputNameSchema,
  }),
  z.strictObject({ character_id: z.uuid(), kind: z.literal("character") }),
]);

export type AnimationSource = z.infer<typeof animationSourceSchema>;

/** What should happen in the video, as the user describes it: trimmed, 1–1000 characters. */
export const animationPromptSchema = z.string().trim().min(1).max(1000);

/**
 * `POST /api/animations` JSON body (a session is needed), plus the optional `request_key` (a
 * UUID) every generation request takes: the `source` image, the `prompt` describing the action,
 * and an optional `seed` (a random one when left out, resolved once into the recipe). Answers
 * `generationReceiptSchema` (201 submitted, 202 waiting, 200 reused); 404 `source_not_found`,
 * 409 `source_not_done`, 422 `source_not_image` or `consent_required` for a source it cannot
 * animate.
 */
export const animateImageInputSchema = z.object({
  prompt: animationPromptSchema,
  seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  source: animationSourceSchema,
});

export type AnimateImageInput = z.infer<typeof animateImageInputSchema>;

/**
 * The search of `/animate`: a source to preselect, a done generation's image output
 * (`generation`, `output`, `image` when left out) or a library character (`character`), and the
 * animation the page follows (`take`). A malformed member is dropped, never an error.
 */
export const animateSearchSchema = z.object({
  character: z.uuid().optional().catch(undefined),
  generation: z.uuid().optional().catch(undefined),
  output: outputNameSchema.optional().catch(undefined),
  take: z.uuid().optional().catch(undefined),
});

export type AnimateSearch = z.infer<typeof animateSearchSchema>;

/** The source a page search preselects, if it names one. */
export function searchSource(search: AnimateSearch): AnimationSource | null {
  if (search.generation) {
    return {
      generation_id: search.generation,
      kind: "generation",
      output: search.output ?? DEFAULT_SOURCE_OUTPUT,
    };
  }

  return search.character ? { character_id: search.character, kind: "character" } : null;
}

/**
 * The `/animate` link that opens with a source preselected: a done generation's image output
 * (`output` defaults to `image`) or a library character. How another feature's "Animate" action
 * hands its result over.
 */
export function animateImageHref(
  source: { characterId: string } | { generationId: string; output?: string },
) {
  const search =
    "characterId" in source
      ? new URLSearchParams({ character: source.characterId })
      : new URLSearchParams({
          generation: source.generationId,
          output: source.output ?? DEFAULT_SOURCE_OUTPUT,
        });

  return `/animate?${search}`;
}

// The video is about as many pixels as the template's 640×640 (Wan 2.2 14B renders 480p-class
// video well there), in the source's aspect clamped to 9:16…16:9, each side a multiple of 16.
const VIDEO_AREA = 640 * 640;
const MIN_ASPECT = 9 / 16;
const MAX_ASPECT = 16 / 9;

/**
 * The video size an image of `width`×`height` animates at: 480×848 for a 9:16 portrait, 848×480
 * for 16:9, 640×640 for a square. WanImageToVideo scales the image to it and crops the centre, so
 * a source outside 9:16…16:9 loses its edges.
 */
export function videoSize(width: number, height: number) {
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, width / height));
  const side = (value: number) => Math.max(16, Math.round(value / 16) * 16);

  return {
    height: side(Math.sqrt(VIDEO_AREA / aspect)),
    width: side(Math.sqrt(VIDEO_AREA * aspect)),
  };
}

/** The video's length: 81 frames at 16 fps, Wan 2.2's native clip. */
export const VIDEO_SECONDS = 81 / 16;
