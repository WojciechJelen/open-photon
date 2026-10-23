// The character builder's public contracts (client-safe, loadable by Node): describe a character,
// enhance the description into a caption (`POST /api/character-captions`, FLUX 3's prompt
// upsampler), render the caption into one image (`POST /api/character-generations`, FLUX 3 Image
// Klein distilled), and save that image as a character of the workspace library, explicitly
// (`POST /api/character-generations/:generationId/character`). Client code imports them from
// `index.ts`.
import { z } from "zod";

import { characterTitleSchema } from "../characters/index.ts";

/** An image side a character renders at: a multiple of 16 (FLUX's latent), 512–2048. */
export const imageSideSchema = z.int().min(512).max(2048).multipleOf(16);

const seedSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The looks a character can be asked for (`characterControlsSchema.style`). */
export const characterStyles = ["realistic", "stylized-3d", "illustration", "anime"] as const;

export type CharacterStyle = (typeof characterStyles)[number];

// A control field as a form sends it: trimmed, at most 200 characters; blank is no value.
const controlText = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value || undefined)
  .optional();

/**
 * The optional controls beside a description, every one optional: `appearance` (face, hair,
 * body; at most 200 characters once trimmed, blank is none), `outfit` (likewise) and `style`
 * (`characterStyles`). `compileCharacterRequest` folds them into the request.
 */
export const characterControlsSchema = z.object({
  appearance: controlText,
  outfit: controlText,
  style: z.enum(characterStyles).optional(),
});

export type CharacterControls = z.output<typeof characterControlsSchema>;

const styleSentences: Record<CharacterStyle, string> = {
  anime: "Style: an anime-style illustration with clean line art and cel shading.",
  illustration: "Style: a digital illustration with clean shapes and soft painterly shading.",
  realistic: "Style: a photorealistic photograph with natural skin and fabric detail.",
  "stylized-3d": "Style: a stylized 3D character render with soft materials.",
};

/**
 * The framing every character is asked for, so Motion Transfer can animate it: one person, the
 * whole body with hands and feet, a neutral standing pose, nothing behind them, even light.
 */
export const CHARACTER_FRAMING =
  "Framing: a single person shown full body from head to toe, both hands and both feet fully visible, standing upright in a relaxed neutral pose facing the camera, on a plain uncluttered background with soft, even lighting.";

/** `text` as a sentence: trimmed, with a full stop unless it ends in one already. */
function sentence(text: string) {
  const trimmed = text.trim();

  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * The request a description and its controls make: the description as a sentence, then each
 * control given (`Appearance: …`, `Outfit: …`, the style's sentence), then `CHARACTER_FRAMING`,
 * joined by spaces. Pure and deterministic: the same description and controls always make the
 * same request. The enhancement's server recomputes it from the stored description and
 * controls; it never takes a request string from a client.
 */
export function compileCharacterRequest(description: string, controls: CharacterControls = {}) {
  return [
    sentence(description),
    controls.appearance && `Appearance: ${sentence(controls.appearance)}`,
    controls.outfit && `Outfit: ${sentence(controls.outfit)}`,
    controls.style && styleSentences[controls.style],
    CHARACTER_FRAMING,
  ]
    .filter(Boolean)
    .join(" ");
}

const descriptionSchema = z.string().trim().min(1).max(1000);

/** The workflow id of a caption enhancement, as its generation rows record it. */
export const CHARACTER_CAPTION_WORKFLOW = "character-caption";

/** The workflow id of a character image, as its generation rows record it. */
export const CHARACTER_GENERATION_WORKFLOW = "character-generation";

/** The text output of a caption enhancement: the enhanced caption. */
export const CAPTION_OUTPUT = "caption";

/** The image output of a character generation, which a character is saved from. */
export const IMAGE_OUTPUT = "image";

/**
 * `POST /api/character-captions` JSON body (a session is needed), with an optional `request_key`
 * (a UUID: the same key answers the same generation again): a `description` (1–1000 characters
 * once trimmed), optional `controls` and an optional `seed` (a random one, resolved once, without
 * it). The server compiles the request (`compileCharacterRequest`) and runs the caption workflow
 * (`character-caption.v1`, the prompt upsampler only), whose one output is the text `caption`
 * (`CAPTION_OUTPUT`), shown inline by `GET /api/generations/:id` once done
 * (`GenerationSnapshotOutput` `{ name: "caption", media: "text", text }`). Its recipe stores the
 * compiled request, the description, the controls, the seed, the upsampler's model pin, the full
 * system prompt, the sampling settings and the recipe identity.
 *
 * Answered like `POST /api/generate` (`generationReceiptSchema` of `src/shared/contracts.ts`):
 * 201 `{ id, reused: false }`, 202 with `status: "waiting"` and `position` in line, 200
 * `{ id, reused: true }` for a recipe done or on its way; 400 for a body that is not this
 * schema, 401 without a session, 429 `rate_limited`.
 */
export const characterCaptionInputSchema = z.object({
  controls: characterControlsSchema.optional(),
  description: descriptionSchema,
  seed: seedSchema.optional(),
});

export type CharacterCaptionInput = z.output<typeof characterCaptionInputSchema>;

/**
 * `POST /api/character-generations` JSON body (a session is needed), with an optional
 * `request_key`: the `caption` to render (1–4000 characters, not all whitespace), stored and sent
 * to the model byte for byte (never trimmed or rewritten); an optional `seed` (resolved once), and
 * `width`/`height` (`imageSideSchema`; `workflows/defaults.json`'s portrait size without them).
 * The image graph never runs the upsampler; its one output is the PNG `image` (`IMAGE_OUTPUT`).
 *
 * `source` says where the caption came from:
 * - with `caption_generation_id`: a `done` caption enhancement (`CHARACTER_CAPTION_WORKFLOW`;
 *   404 for an id no generation has, 409 with a reason for one that is not done or not a caption
 *   enhancement). The server copies its description, controls and enhancement provenance (the
 *   enhanced caption, the upsampler model, the system prompt's SHA-256, the settings, the
 *   generation id) and records whether the caption was `edited` (differs from the enhanced one);
 *   `source.description` and `source.controls` are ignored then.
 * - without it: the provenance is `{ description: source.description ?? null, controls:
 *   source.controls ?? null, enhancement: null }` (a caption written by hand skips enhancement).
 *
 * The recipe is `{ caption, seed, width, height, source: { description, controls, enhancement },
 * models, target, workflow }`; a re-run or retry keeps the caption and the source (a retry draws a
 * new seed only), and a saved character's `prompt` is the caption. Answered as
 * `characterCaptionInputSchema` is.
 */
export const characterGenerationInputSchema = z.object({
  caption: z.string().min(1).max(4000).regex(/\S/, "A caption needs more than whitespace."),
  height: imageSideSchema.optional(),
  seed: seedSchema.optional(),
  source: z
    .object({
      caption_generation_id: z.uuid().optional(),
      controls: characterControlsSchema.optional(),
      description: descriptionSchema.optional(),
    })
    .optional(),
  width: imageSideSchema.optional(),
});

export type CharacterGenerationInput = z.output<typeof characterGenerationInputSchema>;

/**
 * `POST /api/character-generations/:generationId/character` JSON body (a session is needed): an
 * optional `title` (the characters feature's `characterTitleSchema`). Saves the `image` output of
 * a done character generation as a workspace character (`createFromGeneration`): 201 with the new
 * `CharacterSummary` (`characterSummarySchema` of `#/features/characters`), 200 with the one
 * already saved from it; 401 without a session, 404 for an id no generation has, 409 for one
 * that is not done or not a character generation. Only an explicit user action calls it; a
 * generation is never saved on its own.
 */
export const saveCharacterInputSchema = z.object({ title: characterTitleSchema.optional() });

export type SaveCharacterInput = z.output<typeof saveCharacterInputSchema>;
