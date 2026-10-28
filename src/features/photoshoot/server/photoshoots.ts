// A photoshoot's admission, reads and saving a result. Admission is the generation service's
// (`submitMany`: every shot validated, quota checked and stored `waiting` at once, or nothing) on
// the shared image edit's enhanced variant (`imageEditDefinitionFor`); the dispatcher renders the
// shots within `IN_FLIGHT_MAX` with no browser open. This module records which generations make up a
// photoshoot, under the request key that admitted them, and composes each shot's prompt.
import type { Session } from "../../../shared/server/access.server.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findLatestAttempt, snapshot } from "../../../shared/server/generation/generations.ts";
import { type Admit, submitMany } from "../../../shared/server/generation/service.ts";
import { transaction } from "../../../shared/server/migrate.ts";
import { createFromGeneration, getCharacter } from "../../characters/api.ts";
import {
  IMAGE_EDIT_OUTPUT,
  imageEditDefinitionFor,
  type ImageEditInput,
} from "../../imageEdit/api.ts";
import { type CreatePhotoshootInput, type Photoshoot, photoshootSchema } from "../contracts.ts";
import { compileShotPrompt, SHOTS_PER_SESSION } from "../settings.ts";
import {
  findPhotoshoot,
  findPhotoshootByKey,
  findShots,
  insertPhotoshoot,
  listPhotoshoots,
  type PhotoshootItemRow,
  type PhotoshootRow,
} from "./repository.ts";

// How many photoshoots `GET /api/photoshoots` lists.
const LISTED = 30;

/**
 * A shot's current generation: its first one, followed through each failed or cancelled
 * generation's newest child (the shared retry or re-run) to the latest attempt.
 */
function currentAttempt(shot: PhotoshootItemRow) {
  const current = findLatestAttempt(shot.generation_id);

  if (!current) {
    throw new Error(`Photoshoot shot ${shot.position} names no stored generation`);
  }

  return current;
}

/** The photographed character as the page shows it, `null` once it cannot be read. */
function characterOf(row: PhotoshootRow) {
  const character = getCharacter(row.character_id);

  return (
    character && {
      id: character.id,
      image: character.image,
      is_sample: character.is_sample,
      origin: character.origin,
      title: character.title,
    }
  );
}

/** A photoshoot with every shot's current generation (`photoshootSchema`); `null` for none. */
export function readPhotoshoot(id: string): Photoshoot | null {
  const row = findPhotoshoot(id);

  if (!row) {
    return null;
  }

  return photoshootSchema.parse({
    character: characterOf(row),
    created_at: row.created_at,
    id: row.id,
    items: findShots(row.id).map((shot) => {
      const { attempt, row: generation } = currentAttempt(shot);

      return {
        attempt,
        generation: snapshot(generation),
        position: shot.position,
        reused: shot.reused,
      };
    }),
    setting: row.setting,
  });
}

/**
 * Admits a photoshoot of `input.character_id` in `input.setting` under the client's
 * `requestKey`, in one transaction: a photoshoot this key admitted before comes back as it is
 * (`created: false`, nothing stored or charged), a key another access code used is a 409, an
 * unknown character a 404; otherwise its four shots go through `submitMany` (all stored
 * `waiting` or none) and the photoshoot is stored with them in order.
 */
export function createPhotoshoot(
  input: CreatePhotoshootInput,
  session: Session | null,
  submission: { admit?: Admit; provider?: Provider; requestKey: string },
) {
  const owner = session?.codeId;

  if (owner === undefined) {
    throw new GenerateError(401, "Enter an access code to do this.", "access_required");
  }

  return transaction(database, () => {
    const existing = findPhotoshootByKey(submission.requestKey);

    if (existing && existing.access_code_id !== owner) {
      throw new GenerateError(
        409,
        "This request key was used for another request. Send a new one.",
        "request_key_conflict",
      );
    }

    if (existing) {
      return { created: false, photoshoot: readPhotoshoot(existing.id) };
    }

    if (!getCharacter(input.character_id)) {
      throw new GenerateError(404, "That character is not in the library.", "character_not_found");
    }

    // Each shot's prompt is composed here, never taken from the client, with the character's
    // image as the one reference. The prompt upsampler, which sees the reference, writes the
    // caption the edit renders: without it FLUX 3 Klein kept the reference's pose (the evidence,
    // `docs/feature-evidence/character-photoshoot/`). No seed: the workflow draws one per shot.
    const inputs: ImageEditInput[] = Array.from({ length: SHOTS_PER_SESSION }, (_, position) => ({
      enhance: true,
      origin: { feature: "photoshoot", setting: input.setting, shot: position },
      prompt: compileShotPrompt(input.setting, position),
      references: [{ character_id: input.character_id }],
    }));

    const receipts = submitMany(imageEditDefinitionFor({ enhance: true }), inputs, {
      ...submission,
      scope: { free: () => false, session },
    });

    const id = insertPhotoshoot({
      accessCodeId: owner,
      characterId: input.character_id,
      requestKey: submission.requestKey,
      setting: input.setting,
      shots: receipts.map((receipt) => ({ generationId: receipt.id, reused: receipt.reused })),
    });

    return { created: true, photoshoot: readPhotoshoot(id) };
  });
}

/** `GET /api/photoshoots`: the workspace's latest photoshoots with their shots' statuses. */
export function listWorkspacePhotoshoots() {
  return {
    photoshoots: listPhotoshoots(LISTED).map((row) => ({
      character: characterOf(row),
      created_at: row.created_at,
      id: row.id,
      setting: row.setting,
      statuses: findShots(row.id).map((shot) => currentAttempt(shot).row.status),
    })),
  };
}

/**
 * Saves the image of `generationId`, the current generation of one of photoshoot `id`'s shots,
 * to the library (`createFromGeneration`, idempotent per generation): the user's explicit action.
 * 404 when the photoshoot does not exist or the generation is none of its shots'; the characters
 * API's refusals (`CharacterError`, e.g. 409 `not_done`) pass through.
 */
export function saveShot(id: string, generationId: string, title: string | undefined) {
  const row = findPhotoshoot(id);

  const ofShot =
    row !== null && findShots(row.id).some((shot) => currentAttempt(shot).row.id === generationId);

  if (!ofShot) {
    throw new GenerateError(404, "That result is not part of this photoshoot.", "not_found");
  }

  return createFromGeneration({ generationId, outputName: IMAGE_EDIT_OUTPUT, title });
}
