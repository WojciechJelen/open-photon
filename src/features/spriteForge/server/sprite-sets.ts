// Sprite sets and their sheets: admission and reads. Admission is the generation service's
// (`submitMany`: validated, quota checked and stored `waiting` at once, or nothing); the
// dispatcher renders within `IN_FLIGHT_MAX` with no browser open. This module records which
// generations make up a set and which one each sheet is, under the request key that admitted it.
import { randomInt } from "node:crypto";

import type { Session } from "../../../shared/server/access.server.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { providerTarget } from "../../../shared/server/comfy-target.ts";
import { database } from "../../../shared/server/db.server.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findLatestAttempt, snapshot } from "../../../shared/server/generation/generations.ts";
import { type Admit, submitMany } from "../../../shared/server/generation/service.ts";
import { transaction } from "../../../shared/server/migrate.ts";
import { getCharacter } from "../../characters/api.ts";
import {
  type CreateSpriteSetInput,
  type CreateSpriteSheetInput,
  spriteDirections,
  type SpriteSet,
  spriteSetListSchema,
  spriteSetSchema,
  type SpriteViewInput,
} from "../contracts.ts";
import { spriteSheetDefinition } from "../workflows/sheet-definition.ts";
import { spriteViewDefinition } from "../workflows/view-definition.ts";
import {
  findSpriteSet,
  findSpriteSetByKey,
  findSpriteSheetByKey,
  findSpriteSheets,
  findSpriteViews,
  insertSpriteSet,
  insertSpriteSheet,
  listSpriteSetRows,
} from "./repository.ts";

// How many sets `GET /api/sprite-sets` lists.
const LISTED = 50;

// The seed a set draws when the request names none: below 2^48, as `randomInt` draws.
const SEED_RANGE = 2 ** 48 - 1;

/** What admission needs besides the body: the request's rate limit, provider, key and session. */
type Admission = {
  admit?: Admit;
  provider?: Provider;
  requestKey: string;
  session: Session | null;
};

/** The session's access code, or the 401 every admission answers without one. */
function sessionCode(session: Session | null) {
  if (!session) {
    throw new GenerateError(401, "Enter an access code to do this.", "access_required");
  }

  return session.codeId;
}

/**
 * The latest attempt of a set's view or sheet (its first generation followed through each failed
 * or cancelled one's child: the shared retry or re-run) and how many attempts that took.
 */
function latest(generationId: string, what: string) {
  const current = findLatestAttempt(generationId);

  if (!current) {
    throw new Error(`The sprite ${what} names no stored generation ${generationId}`);
  }

  return current;
}

/** A stored set's views, each with its current generation row, in direction order. */
function currentViews(setId: string) {
  return findSpriteViews(setId).map((view) => ({
    ...view,
    current: latest(view.generation_id, `${view.direction} view`),
  }));
}

/**
 * A set with every view's and sheet's current generation (`spriteSetSchema`, sheets most recent
 * first); `null` for an unknown id. The character is the library's summary, which the schema
 * narrows to what the page shows; `null` once it is gone.
 */
export function readSpriteSet(id: string): SpriteSet | null {
  const set = findSpriteSet(id);

  return (
    set &&
    spriteSetSchema.parse({
      character: getCharacter(set.character_id),
      created_at: set.created_at,
      id: set.id,
      seed: set.seed,
      sheets: findSpriteSheets(set.id).map((sheet) => {
        const { attempt, row } = latest(sheet.generation_id, "sheet");

        return {
          attempt,
          created_at: sheet.created_at,
          facing: sheet.facing,
          generation: snapshot(row),
          id: sheet.id,
          takes: sheet.takes,
        };
      }),
      // Only a self-hosted ComfyUI has the Sprite Forge custom nodes a sheet runs.
      sheets_available: providerTarget().kind === "selfhost",
      views: currentViews(set.id).map(({ current, direction, position, reused }) => ({
        attempt: current.attempt,
        direction,
        generation: snapshot(current.row),
        position,
        reused,
      })),
    })
  );
}

/**
 * Admits a sprite set of `input.character_id` under the client's `requestKey`, in one
 * transaction: a set this key admitted before comes back as it is (`created: false`, nothing
 * stored or charged), a key another access code used is a 409; otherwise the five directions go
 * through `submitMany` of `sprite-view` in `spriteDirections` order with one seed (the quota
 * checked for every new view, all stored `waiting` or none; an existing view with the same recipe
 * comes back free, `reused`) and the set is stored with them. Any refusal stores nothing.
 */
export function createSpriteSet(input: CreateSpriteSetInput, options: Admission) {
  const { requestKey, session } = options;
  const codeId = sessionCode(session);

  return transaction(database, () => {
    const earlier = findSpriteSetByKey(requestKey);

    if (earlier) {
      if (earlier.access_code_id !== codeId) {
        throw new GenerateError(
          409,
          "Send a new request key: this one is taken.",
          "request_key_conflict",
        );
      }

      return { created: false, set: readSpriteSet(earlier.id) };
    }

    const seed = input.seed ?? randomInt(SEED_RANGE);

    const inputs = spriteDirections.map((direction): SpriteViewInput => ({
      character_id: input.character_id,
      direction,
      seed,
    }));

    const receipts = submitMany(spriteViewDefinition, inputs, {
      admit: options.admit,
      provider: options.provider,
      requestKey,
      scope: { free: () => false, session },
    });

    const views = spriteDirections.map((direction, index) => {
      const receipt = receipts[index];

      if (!receipt) {
        throw new Error(`submitMany answered no generation for the ${direction} view`);
      }

      return { direction, generationId: receipt.id, reused: receipt.reused };
    });

    const id = insertSpriteSet({
      accessCodeId: codeId,
      characterId: input.character_id,
      requestKey,
      seed,
      views,
    });

    return { created: true, set: readSpriteSet(id) };
  });
}

/** `GET /api/sprite-sets`: the latest sets with each view's current status and the last sheet's. */
export function listSpriteSets() {
  return spriteSetListSchema.parse({
    sets: listSpriteSetRows(LISTED).map((set) => {
      const [last] = findSpriteSheets(set.id);

      return {
        character: getCharacter(set.character_id),
        created_at: set.created_at,
        id: set.id,
        sheet_status: last ? latest(last.generation_id, "sheet").row.status : null,
        views: currentViews(set.id).map(({ current, direction }) => ({
          direction,
          status: current.row.status,
        })),
      };
    }),
  });
}

/** The answer to a sheet's admission: its set as it reads now, and the sheet in it. */
function sheetAnswer(setId: string, sheetId: string, created: boolean) {
  const set = readSpriteSet(setId);
  const sheet = set?.sheets.find((each) => each.id === sheetId);

  if (!set || !sheet) {
    throw new Error(`Sprite sheet ${sheetId} is not in its set ${setId}`);
  }

  return { created, set, sheet };
}

/**
 * Admits a sprite sheet of set `setId` under the client's `requestKey`, in one transaction: 404
 * `not_found` for an unknown set; the sheet this key admitted before for this set comes back as
 * it is (`created: false`), a key another code (or another set) used is a 409; 409
 * `views_not_done` unless every view's current generation is done; otherwise one `sprite-sheet`
 * generation from those current views goes through `submitMany` (the definition refuses a Comfy
 * Cloud target, 422 `selfhost_required`) and the sheet is stored with it. Any refusal stores
 * nothing.
 */
export function createSpriteSheet(
  setId: string,
  input: CreateSpriteSheetInput,
  options: Admission,
) {
  const { requestKey, session } = options;
  const codeId = sessionCode(session);

  return transaction(database, () => {
    if (!findSpriteSet(setId)) {
      throw new GenerateError(404, "Sprite set not found.", "not_found");
    }

    const earlier = findSpriteSheetByKey(requestKey);

    if (earlier) {
      // A key is one sheet of one set: used by another code, or for another set's sheet, it
      // cannot answer this request.
      if (earlier.access_code_id !== codeId || earlier.set_id !== setId) {
        throw new GenerateError(
          409,
          "Send a new request key: this one is taken.",
          "request_key_conflict",
        );
      }

      return sheetAnswer(setId, earlier.id, false);
    }

    const views = currentViews(setId);

    if (views.some(({ current }) => current.row.status !== "done")) {
      throw new GenerateError(
        409,
        "Every direction must be drawn before a sprite sheet is forged.",
        "views_not_done",
      );
    }

    // The views are the set's current generations, never the client's; the definition's input
    // schema (checked by `submitMany`) validates the assembled input.
    const sheetInput = {
      facing: input.facing,
      takes: input.takes,
      views: Object.fromEntries(views.map(({ current, direction }) => [direction, current.row.id])),
    };

    const [receipt] = submitMany(spriteSheetDefinition, [sheetInput], {
      admit: options.admit,
      provider: options.provider,
      requestKey,
      scope: { free: () => false, session },
    });

    if (!receipt) {
      throw new Error("submitMany answered no generation for the sprite sheet");
    }

    const id = insertSpriteSheet({
      accessCodeId: codeId,
      facing: input.facing,
      generationId: receipt.id,
      requestKey,
      setId,
      takes: input.takes,
    });

    return sheetAnswer(setId, id, true);
  });
}
