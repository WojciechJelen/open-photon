// The photoshoot feature's client calls: its own endpoints, the workspace character list and the
// consented photo upload of the characters API, and the shared retry of a generation. Client-safe.
import { characterListSchema, characterSummarySchema } from "#/features/characters";
import {
  type CreatePhotoshootInput,
  photoshootListSchema,
  photoshootSchema,
} from "#/features/photoshoot/contracts";
import { generationReceiptSchema } from "#/shared/contracts";
import { callApi } from "#/shared/requests";

const json = { Accept: "application/json" };
const jsonBody = { ...json, "Content-Type": "application/json" };

/**
 * `POST /api/photoshoots` under `requestKey`: the same key again (a lost answer, a second click)
 * returns the photoshoot it admitted, never a second one.
 */
export function postPhotoshoot(input: CreatePhotoshootInput, requestKey: string) {
  return callApi(photoshootSchema, "/api/photoshoots", {
    body: JSON.stringify({ ...input, request_key: requestKey }),
    headers: jsonBody,
    method: "POST",
  });
}

export function fetchPhotoshoot(id: string, signal?: AbortSignal) {
  return callApi(photoshootSchema, `/api/photoshoots/${id}`, { headers: json, signal });
}

export function fetchPhotoshoots(signal?: AbortSignal) {
  return callApi(photoshootListSchema, "/api/photoshoots", { headers: json, signal });
}

/** `GET /api/characters`: the workspace library and the samples. */
export function fetchLibrary(signal?: AbortSignal) {
  return callApi(characterListSchema, "/api/characters", { headers: json, signal });
}

/**
 * `POST /api/characters`: a photo of a person, with the uploader's likeness consent (asked for
 * first; the server refuses an upload without it). It joins the library as a character.
 */
export function uploadReference(file: File) {
  const form = new FormData();

  form.append("consent", "true");
  form.append("image", file);

  return callApi(characterSummarySchema, "/api/characters", { body: form, method: "POST" });
}

/** `POST /api/photoshoots/:id/character`: one result into the library, the user's choice. */
export function saveResult(photoshootId: string, generationId: string) {
  return callApi(characterSummarySchema, `/api/photoshoots/${photoshootId}/character`, {
    body: JSON.stringify({ generation_id: generationId }),
    headers: jsonBody,
    method: "POST",
  });
}

/** `POST /api/generations/:id/retry`, the shared retry of a failed shot (a new seed). */
export function retryShot(generationId: string) {
  return callApi(generationReceiptSchema, `/api/generations/${generationId}/retry`, {
    headers: json,
    method: "POST",
  });
}
