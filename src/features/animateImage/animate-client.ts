// The animate page's one typed client for the HTTP API it drives: the animation itself
// (`POST /api/animations`, with a request key), the library it picks characters from
// (`GET /api/characters`), and the shared reads and retry of a generation. Every call answers
// `{ data }` or `{ refusal }` (`callApi`); nothing here holds state. Uploads go through the
// shared `uploadImageFile`.
import type { AnimateImageInput } from "#/features/animateImage/contracts";
import { characterListSchema } from "#/features/characters";
import { generationReceiptSchema, generationSchema } from "#/shared/contracts";
import { callApi } from "#/shared/requests";

/** Starts (or, with a `requestKey` used before, finds again) the animation of `input`. */
export function requestAnimation(input: AnimateImageInput, requestKey: string) {
  return callApi(generationReceiptSchema, "/api/animations", {
    body: JSON.stringify({ ...input, request_key: requestKey }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

/** A generation as stored, with its outputs once it is done (`GET /api/generations/:id`). */
export function readGeneration(id: string) {
  return callApi(generationSchema, `/api/generations/${id}`, { method: "GET" });
}

/** The shared retry of a failed animation: the same source and prompt with a new seed. */
export function retryAnimation(id: string) {
  return callApi(generationReceiptSchema, `/api/generations/${id}/retry`, { method: "POST" });
}

/** The workspace library with the samples, most recent first. */
export function readLibrary() {
  return callApi(characterListSchema, "/api/characters", { method: "GET" });
}
