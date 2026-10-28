// Shots & Angles' client calls: its own endpoints and the shared retry of a view's generation.
// Client-safe.
import {
  type AngleView,
  angleSetListSchema,
  angleSetSchema,
  type AngleSetItem,
} from "#/features/angles/contracts";
import { characterSummarySchema } from "#/features/characters";
import { generationReceiptSchema } from "#/shared/contracts";
import { callApi } from "#/shared/requests";

const json = { Accept: "application/json", "Content-Type": "application/json" };

/**
 * `POST /api/angle-sets`: admits the `views` of `characterId` under `requestKey`; the same key
 * again (a lost answer, a second click) returns the set it admitted, never a second one.
 */
export function postAngleSet(characterId: string, views: AngleView[], requestKey: string) {
  return callApi(angleSetSchema, "/api/angle-sets", {
    body: JSON.stringify({ character_id: characterId, request_key: requestKey, views }),
    headers: json,
    method: "POST",
  });
}

/** `GET /api/angle-sets/:id`. */
export function fetchAngleSet(id: string, signal?: AbortSignal) {
  return callApi(angleSetSchema, `/api/angle-sets/${id}`, { headers: json, signal });
}

/** `GET /api/angle-sets`: the workspace's latest sets. */
export function fetchAngleSets(signal?: AbortSignal) {
  return callApi(angleSetListSchema, "/api/angle-sets", { headers: json, signal });
}

/** Saves view `position` of set `setId` to the library (`{}`: no title); idempotent. */
export function saveViewToLibrary(setId: string, position: number) {
  return callApi(characterSummarySchema, `/api/angle-sets/${setId}/items/${position}/character`, {
    body: "{}",
    headers: json,
    method: "POST",
  });
}

/**
 * `POST /api/generations/:id/retry`, the shared retry: a failed or cancelled view's child with a
 * new seed; refused (409) for an `unknown` one, which Comfy may still be rendering.
 */
export function retryView(item: AngleSetItem) {
  return callApi(generationReceiptSchema, `/api/generations/${item.generation.id}/retry`, {
    headers: json,
    method: "POST",
  });
}
