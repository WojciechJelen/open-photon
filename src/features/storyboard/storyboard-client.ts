// The storyboard feature's client calls: its own endpoints and the shared retry of a generation.
// Client-safe.
import {
  type CreateStoryboardBody,
  type GenerateCardsBody,
  type SaveStoryboardBody,
  storyboardListSchema,
  storyboardSchema,
} from "#/features/storyboard/contracts";
import { generationReceiptSchema } from "#/shared/contracts";
import { callApi } from "#/shared/requests";

const json = { Accept: "application/json" };
const sending = { ...json, "Content-Type": "application/json" };

/**
 * `POST /api/storyboards` under `requestKey`: the same key again (a lost answer, a second click)
 * returns the storyboard it made, never a second one.
 */
export function postStoryboard(body: CreateStoryboardBody, requestKey: string) {
  return callApi(storyboardSchema, "/api/storyboards", {
    body: JSON.stringify({ ...body, request_key: requestKey }),
    headers: sending,
    method: "POST",
  });
}

/** `GET /api/storyboards/:id`. */
export function fetchStoryboard(id: string, signal?: AbortSignal) {
  return callApi(storyboardSchema, `/api/storyboards/${id}`, { headers: json, signal });
}

/** `GET /api/storyboards`: the workspace's storyboards. */
export function fetchStoryboards(signal?: AbortSignal) {
  return callApi(storyboardListSchema, "/api/storyboards", { headers: json, signal });
}

/** `PUT /api/storyboards/:id`: saves the title, style and every description. */
export function putStoryboard(id: string, body: SaveStoryboardBody) {
  return callApi(storyboardSchema, `/api/storyboards/${id}`, {
    body: JSON.stringify(body),
    headers: sending,
    method: "PUT",
  });
}

/**
 * `POST /api/storyboards/:id/generations` under `requestKey`: saves the storyboard and renders
 * the named cards; the same key again renders nothing more.
 */
export function postCardGenerations(id: string, body: GenerateCardsBody, requestKey: string) {
  return callApi(storyboardSchema, `/api/storyboards/${id}/generations`, {
    body: JSON.stringify({ ...body, request_key: requestKey }),
    headers: sending,
    method: "POST",
  });
}

/**
 * `POST /api/generations/:id/retry`, the shared retry of a failed scene split: a child with a new
 * seed, which the storyboard follows.
 */
export function retryGeneration(id: string) {
  return callApi(generationReceiptSchema, `/api/generations/${id}/retry`, {
    headers: json,
    method: "POST",
  });
}
