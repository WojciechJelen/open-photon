import { batchListSchema, batchSchema, type BatchVariation } from "#/features/batches/contracts";
// The batches feature's client calls: its own endpoints, the workspace character list it varies
// characters from, and the shared retry of a generation. Client-safe.
import { characterListSchema } from "#/features/characters";
import type { DraftSnapshot } from "#/features/motionTransfer/api";
import { generationReceiptSchema } from "#/shared/contracts";
import { callApi } from "#/shared/requests";

const json = { Accept: "application/json" };

/**
 * `POST /api/batches`: admits `variation` of `shot` under `requestKey`; the same key again (a
 * lost answer, a second click) returns the batch it admitted, never a second one.
 */
export function postBatch(
  body: { shot: DraftSnapshot; variation: BatchVariation },
  requestKey: string,
) {
  return callApi(batchSchema, "/api/batches", {
    body: JSON.stringify({ ...body, request_key: requestKey }),
    headers: { ...json, "Content-Type": "application/json" },
    method: "POST",
  });
}

/** `GET /api/batches/:id`. */
export function fetchBatch(id: string, signal?: AbortSignal) {
  return callApi(batchSchema, `/api/batches/${id}`, { headers: json, method: "GET", signal });
}

/** `GET /api/batches`: the workspace's batches and the session's allowance. */
export function fetchBatches(signal?: AbortSignal) {
  return callApi(batchListSchema, "/api/batches", { headers: json, method: "GET", signal });
}

/** `GET /api/characters`: the workspace library and the samples, the characters a batch may use. */
export function fetchCharacters(signal?: AbortSignal) {
  return callApi(characterListSchema, "/api/characters", { headers: json, method: "GET", signal });
}

/**
 * `POST /api/generations/:id/retry`, the shared retry: a failed or cancelled generation's child
 * with a new seed; refused (409) for an `unknown` one, which Comfy may still be rendering.
 */
export function retryGeneration(id: string) {
  return callApi(generationReceiptSchema, `/api/generations/${id}/retry`, {
    headers: json,
    method: "POST",
  });
}

/** `count` random seeds, all different, as a seed batch varies them. */
export function randomSeeds(count: number) {
  const seeds = new Set<number>();

  while (seeds.size < count) {
    seeds.add(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0);
  }

  return [...seeds];
}

/** What a character is called on the batch's pages: its title, or what it is. */
export function characterName(character: { origin: "generated" | "upload"; title: string | null }) {
  return (
    character.title ?? (character.origin === "upload" ? "Untitled photo" : "Untitled character")
  );
}

/**
 * A character image's alt text: its name, and for a generated one that it is AI-generated (the
 * FLUX licence asks for generated outputs to be disclosed wherever they are shown).
 */
export function characterAlt(character: { origin: "generated" | "upload"; title: string | null }) {
  return character.origin === "generated"
    ? `${characterName(character)}, AI-generated image`
    : characterName(character);
}

/** The look a shot keeps, in words: its prompt, or the photo's own look. */
export function lookLabel(shot: DraftSnapshot) {
  return shot.prompt?.trim() || "From the photo";
}

/** The seed a shot keeps, in words: a number, or the workflow's fixed default. */
export function seedLabel(shot: DraftSnapshot) {
  return shot.seed === undefined || shot.seed === "default" ? "Default seed" : `Seed ${shot.seed}`;
}
