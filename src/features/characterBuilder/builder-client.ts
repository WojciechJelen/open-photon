// The builder page's one typed client for the HTTP API it drives: the caption enhancement
// (`POST /api/character-captions`), the image generation (`POST /api/character-generations`),
// the explicit save (`POST /api/character-generations/:id/character`), the shared retry and the
// shared reads of a generation and its stored recipe. Every call answers `{ data }` or
// `{ refusal }` (`callApi`); nothing here holds state.
import { z } from "zod";

import {
  type CharacterCaptionInput,
  characterControlsSchema,
  type CharacterGenerationInput,
  type SaveCharacterInput,
} from "#/features/characterBuilder/contracts";
import { characterSummarySchema } from "#/features/characters";
import { generationReceiptSchema, generationSchema } from "#/shared/contracts";
import { callApi } from "#/shared/requests";

/** A body the builder posts: one of its requests, with its `request_key` when it has one. */
type RequestBody = (CharacterCaptionInput | CharacterGenerationInput | SaveCharacterInput) & {
  request_key?: string;
};

function postJson(body: RequestBody): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  };
}

/** Starts (or, with a `requestKey` used before, finds again) the caption enhancement. */
export function requestCaption(input: CharacterCaptionInput, requestKey: string) {
  return callApi(
    generationReceiptSchema,
    "/api/character-captions",
    postJson({ ...input, request_key: requestKey }),
  );
}

/** Starts (or, with a `requestKey` used before, finds again) the character image generation. */
export function requestImage(input: CharacterGenerationInput, requestKey: string) {
  return callApi(
    generationReceiptSchema,
    "/api/character-generations",
    postJson({ ...input, request_key: requestKey }),
  );
}

/** The shared retry of a failed or cancelled generation: the same request with a new seed. */
export function retryGeneration(id: string) {
  return callApi(generationReceiptSchema, `/api/generations/${id}/retry`, { method: "POST" });
}

/**
 * Saves a done image generation's `image` as a workspace character; the same generation again
 * answers with the character it made the first time.
 */
export function saveCharacter(generationId: string, title: string | undefined) {
  return callApi(
    characterSummarySchema,
    `/api/character-generations/${generationId}/character`,
    postJson(title === undefined ? {} : { title }),
  );
}

/** A generation as stored, with its outputs once it is done. */
export function readGeneration(id: string) {
  return callApi(generationSchema, `/api/generations/${id}`, { method: "GET" });
}

/** What the builder reads back from a caption generation's recipe: what was described. */
const captionRecipeSchema = z.object({
  controls: characterControlsSchema.nullable().optional(),
  description: z.string(),
});

export type CaptionRecipe = z.output<typeof captionRecipeSchema>;

/** A caption generation's stored recipe (`GET /api/generations/:id/recipe.json`). */
export function readCaptionRecipe(id: string) {
  return callApi(captionRecipeSchema, `/api/generations/${id}/recipe.json`, { method: "GET" });
}

/**
 * What the builder reads back from an image generation's recipe: the caption exactly as it was
 * sent, the seed and size, and where the caption came from.
 */
const imageRecipeSchema = z.object({
  caption: z.string(),
  height: z.int(),
  seed: z.int(),
  source: z.object({
    controls: characterControlsSchema.nullable(),
    description: z.string().nullable(),
    enhancement: z.object({ edited: z.boolean(), generation_id: z.uuid() }).loose().nullable(),
  }),
  width: z.int(),
});

export type ImageRecipe = z.output<typeof imageRecipeSchema>;

/** An image generation's stored recipe (`GET /api/generations/:id/recipe.json`). */
export function readImageRecipe(id: string) {
  return callApi(imageRecipeSchema, `/api/generations/${id}/recipe.json`, { method: "GET" });
}
