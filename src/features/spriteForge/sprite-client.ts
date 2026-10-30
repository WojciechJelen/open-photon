import {
  createdSpriteSheetSchema,
  type CreateSpriteSheetInput,
  spriteSetListSchema,
  spriteSetSchema,
} from "#/features/spriteForge/contracts";
// Sprite Forge's client calls: its own endpoints and the shared retry of a view's or a sheet's
// generation. Client-safe.
import { generationReceiptSchema } from "#/shared/contracts";
import { callApi } from "#/shared/requests";

const headers = { Accept: "application/json", "Content-Type": "application/json" };

/**
 * `POST /api/sprite-sets`: admits the five direction views of `characterId` under `requestKey`;
 * the same key again (a lost answer, a second click) returns the set it admitted.
 */
export function postSpriteSet(characterId: string, requestKey: string) {
  return callApi(spriteSetSchema, "/api/sprite-sets", {
    body: JSON.stringify({ character_id: characterId, request_key: requestKey }),
    headers,
    method: "POST",
  });
}

/** `GET /api/sprite-sets`: the workspace's latest sets. */
export function fetchSpriteSets(signal?: AbortSignal) {
  return callApi(spriteSetListSchema, "/api/sprite-sets", { headers, signal });
}

/** `GET /api/sprite-sets/:id`. */
export function fetchSpriteSet(id: string, signal?: AbortSignal) {
  return callApi(spriteSetSchema, `/api/sprite-sets/${id}`, { headers, signal });
}

/**
 * `POST /api/sprite-sets/:id/sheets`: forges a sheet from the set's current views with `input`;
 * the same `requestKey` again returns the sheet it admitted.
 */
export function postSpriteSheet(setId: string, input: CreateSpriteSheetInput, requestKey: string) {
  return callApi(createdSpriteSheetSchema, `/api/sprite-sets/${setId}/sheets`, {
    body: JSON.stringify({ ...input, request_key: requestKey }),
    headers,
    method: "POST",
  });
}

/**
 * `POST /api/generations/:id/retry`, the shared retry: a failed or cancelled view or sheet renders
 * again as a child with a new seed, which the set then follows.
 */
export function retryGeneration(generationId: string) {
  return callApi(generationReceiptSchema, `/api/generations/${generationId}/retry`, {
    headers,
    method: "POST",
  });
}
