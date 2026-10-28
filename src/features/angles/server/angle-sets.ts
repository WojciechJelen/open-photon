// An angle set's admission, reads and saves. Admission is the generation service's (`submitMany`:
// every view validated, quota checked and stored `waiting` at once, or nothing); the dispatcher
// renders the views within `IN_FLIGHT_MAX` with no browser open. This module records which
// generations make up a set, under the request key that admitted them.
import { randomInt } from "node:crypto";

import type { Session } from "../../../shared/server/access.server.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findGeneration, snapshot } from "../../../shared/server/generation/generations.ts";
import { type Admit, submitMany } from "../../../shared/server/generation/service.ts";
import { transaction } from "../../../shared/server/migrate.ts";
import { CharacterError, createFromGeneration, getCharacter } from "../../characters/api.ts";
import {
  type AngleSet,
  angleSetListSchema,
  angleSetSchema,
  type CreateAngleSetInput,
  VIEW_OUTPUT,
} from "../contracts.ts";
import { angleViewDefinition } from "../workflows/definition.ts";
import {
  findChild,
  findSavedCharacter,
  findSet,
  findSetByKey,
  findViews,
  insertSet,
  listSets,
  recordSavedCharacter,
  type ViewRow,
} from "./repository.ts";

// How many sets `GET /api/angle-sets` lists.
const LISTED = 50;

// The seed a set draws when the request names none: below 2^48, as `randomInt` draws.
const SEED_RANGE = 2 ** 48 - 1;

/**
 * A view's current generation: its first one, followed through each failed or cancelled
 * generation's child (the shared retry or re-run) to the latest attempt, and how many that took.
 */
function currentGeneration(view: ViewRow) {
  let row = findGeneration(view.generation_id);
  let attempt = 0;

  while (row?.status === "failed" || row?.status === "cancelled") {
    const child = findChild(row.id);
    const next = child ? findGeneration(child) : null;

    if (!next) {
      break;
    }

    row = next;
    attempt += 1;
  }

  if (!row) {
    throw new Error(`Angle view ${view.position} names no stored generation`);
  }

  return { attempt, row };
}

/** The set's character as its page shows it, `null` when it is gone. */
function setCharacter(id: string) {
  const character = getCharacter(id);

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

/** A set with every view's current generation (`angleSetSchema`); `null` for an unknown id. */
export function readAngleSet(id: string): AngleSet | null {
  const set = findSet(id);

  if (!set) {
    return null;
  }

  return angleSetSchema.parse({
    character: setCharacter(set.character_id),
    created_at: set.created_at,
    id: set.id,
    items: findViews(set.id).map((view) => {
      const { attempt, row } = currentGeneration(view);

      return {
        attempt,
        generation: snapshot(row),
        position: view.position,
        reused: view.reused,
        saved_character_id: findSavedCharacter(row.id),
        view: view.view,
      };
    }),
    seed: set.seed,
  });
}

/**
 * Admits an angle set of `input.character_id` from `input.views` under the client's
 * `requestKey`, in one transaction: a set this key admitted before comes back as it is
 * (`created: false`, nothing stored or charged), a key another access code used is a 409;
 * otherwise every view goes through `submitMany` of `angle-view` with the set's one seed (each
 * input validated, the quota checked for every new view, all stored `waiting` or none; an
 * existing view with the same recipe comes back free, `reused`) and the set is stored with its
 * views in order. Any refusal stores nothing. `admit` is the request's rate limit.
 */
export function createAngleSet(
  input: CreateAngleSetInput,
  options: { admit?: Admit; provider?: Provider; requestKey: string; session: Session | null },
) {
  const { admit, provider, requestKey, session } = options;

  if (!session) {
    throw new GenerateError(401, "Enter an access code to do this.", "access_required");
  }

  return transaction(database, () => {
    const existing = findSetByKey(requestKey);

    if (existing?.access_code_id === session.codeId) {
      return { created: false, set: readAngleSet(existing.id) };
    }

    if (existing) {
      throw new GenerateError(
        409,
        "Send a new request key: this one is taken.",
        "request_key_conflict",
      );
    }

    const seed = input.seed ?? randomInt(SEED_RANGE);

    const receipts = submitMany(
      angleViewDefinition,
      input.views.map((view) => ({ character_id: input.character_id, seed, view })),
      { admit, provider, requestKey, scope: { free: () => false, session } },
    );

    const id = insertSet({
      accessCodeId: session.codeId,
      characterId: input.character_id,
      requestKey,
      seed,
      views: input.views.map((view, index) => {
        const receipt = receipts[index];

        if (!receipt) {
          throw new Error(`submitMany answered no generation for view ${index}`);
        }

        return { generationId: receipt.id, reused: receipt.reused, view };
      }),
    });

    return { created: true, set: readAngleSet(id) };
  });
}

/** `GET /api/angle-sets`: the workspace's latest sets with each view's current status. */
export function listAngleSets() {
  return angleSetListSchema.parse({
    sets: listSets(LISTED).map((set) => ({
      character: setCharacter(set.character_id),
      created_at: set.created_at,
      id: set.id,
      views: findViews(set.id).map((view) => ({
        status: currentGeneration(view).row.status,
        view: view.view,
      })),
    })),
  });
}

/**
 * Saves the current image of view `position` of set `setId` to the library, the user's explicit
 * action after seeing it (`createFromGeneration`, idempotent per generation): the character and
 * whether it is new. 404 `not_found` for no such set or view; the characters API's refusals
 * (409 `not_done`, 422 `invalid_title`, …) as `CharacterError`.
 */
export function saveView(setId: string, position: number, title?: string) {
  const view = findSet(setId) && findViews(setId).find((each) => each.position === position);

  if (!view) {
    throw new CharacterError(404, "No view of an angle set is there.", "not_found");
  }

  const { row } = currentGeneration(view);

  return transaction(database, () => {
    const saved = createFromGeneration({ generationId: row.id, outputName: VIEW_OUTPUT, title });

    recordSavedCharacter(row.id, saved.character.id);

    return saved;
  });
}
