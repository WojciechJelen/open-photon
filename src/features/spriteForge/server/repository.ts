// Sprite Forge's tables (`spriteForge/001-sprite-sets.sql`): a set's identity, request key,
// character and seed, its five views' generation references in direction order, and the sheets
// forged from it. Generations are the generation service's; nothing here writes one.
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { database } from "../../../shared/server/db.server.ts";
import {
  facingSchema,
  type SheetFacing,
  type SheetTakes,
  sheetTakesSchema,
  type SpriteDirection,
  spriteDirectionSchema,
  spriteSetSchema,
} from "../contracts.ts";

// What a set is read for, a page or the list: the columns `spriteSetSchema` answers as they are,
// and the library character it renders.
const SET_COLUMNS = "id, character_id, seed, created_at";

const spriteSetRowSchema = spriteSetSchema
  .pick({ created_at: true, id: true, seed: true })
  .extend({ character_id: z.uuid() });

// What a request key's earlier set says to its admission: whose key it was, and which set.
const admittedSetRowSchema = z.object({ access_code_id: z.string(), id: z.uuid() });

const spriteViewRowSchema = z.object({
  direction: spriteDirectionSchema,
  generation_id: z.uuid(),
  position: z.int().nonnegative(),
  reused: z.int().transform((stored) => stored === 1),
});

// A sheet row with its three facing columns gathered into the `SheetFacing` the API answers.
const spriteSheetRowSchema = z
  .object({
    access_code_id: z.string(),
    created_at: z.iso.datetime(),
    facing_nw: facingSchema,
    facing_sw: facingSchema,
    facing_w: facingSchema,
    generation_id: z.uuid(),
    id: z.uuid(),
    request_key: z.string(),
    set_id: z.uuid(),
    takes: sheetTakesSchema,
  })
  .transform(({ facing_nw, facing_sw, facing_w, ...sheet }) => ({
    ...sheet,
    facing: { nw: facing_nw, sw: facing_sw, w: facing_w } satisfies SheetFacing,
  }));

export function findSpriteSet(id: string) {
  const row = database.prepare(`SELECT ${SET_COLUMNS} FROM sprite_sets WHERE id = ?`).get(id);

  return row === undefined ? null : spriteSetRowSchema.parse(row);
}

/** The set a request key admitted, `null` for a key no set has. */
export function findSpriteSetByKey(requestKey: string) {
  const row = database
    .prepare("SELECT id, access_code_id FROM sprite_sets WHERE request_key = ?")
    .get(requestKey);

  return row === undefined ? null : admittedSetRowSchema.parse(row);
}

/** A set's views, in direction order. */
export function findSpriteViews(setId: string) {
  return z
    .array(spriteViewRowSchema)
    .parse(
      database
        .prepare(
          "SELECT position, direction, generation_id, reused FROM sprite_set_views WHERE set_id = ? ORDER BY position",
        )
        .all(setId),
    );
}

/** The workspace's sets, most recent first (at most `limit`). */
export function listSpriteSetRows(limit: number) {
  return z
    .array(spriteSetRowSchema)
    .parse(
      database
        .prepare(`SELECT ${SET_COLUMNS} FROM sprite_sets ORDER BY created_at DESC, id DESC LIMIT ?`)
        .all(limit),
    );
}

/**
 * Stores a set and its views, each with the generation `submitMany` answered for it. The caller
 * runs it in the transaction that admitted them, so a set exists exactly when its generations do.
 */
export function insertSpriteSet(set: {
  accessCodeId: string;
  characterId: string;
  requestKey: string;
  seed: number;
  views: ReadonlyArray<{ direction: SpriteDirection; generationId: string; reused: boolean }>;
}) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  database
    .prepare(
      "INSERT INTO sprite_sets (id, request_key, access_code_id, character_id, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, set.requestKey, set.accessCodeId, set.characterId, set.seed, createdAt);

  const addView = database.prepare(
    "INSERT INTO sprite_set_views (set_id, position, direction, generation_id, reused) VALUES (?, ?, ?, ?, ?)",
  );

  for (const [position, view] of set.views.entries()) {
    addView.run(id, position, view.direction, view.generationId, view.reused ? 1 : 0);
  }

  return id;
}

/** The sheet a request key admitted, `null` for a key no sheet has. */
export function findSpriteSheetByKey(requestKey: string) {
  const row = database.prepare("SELECT * FROM sprite_sheets WHERE request_key = ?").get(requestKey);

  return row === undefined ? null : spriteSheetRowSchema.parse(row);
}

/**
 * A set's sheets, most recent first: by creation time, then by insertion order for two stored
 * within the same millisecond.
 */
export function findSpriteSheets(setId: string) {
  return z
    .array(spriteSheetRowSchema)
    .parse(
      database
        .prepare(
          "SELECT * FROM sprite_sheets WHERE set_id = ? ORDER BY created_at DESC, rowid DESC",
        )
        .all(setId),
    );
}

/**
 * Stores a sheet of set `setId` with the generation `submitMany` answered for it, in the
 * transaction that admitted it.
 */
export function insertSpriteSheet(sheet: {
  accessCodeId: string;
  facing: SheetFacing;
  generationId: string;
  requestKey: string;
  setId: string;
  takes: SheetTakes;
}) {
  const id = randomUUID();

  database
    .prepare(
      `INSERT INTO sprite_sheets
        (id, set_id, request_key, access_code_id, generation_id, facing_sw, facing_w, facing_nw, takes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sheet.setId,
      sheet.requestKey,
      sheet.accessCodeId,
      sheet.generationId,
      sheet.facing.sw,
      sheet.facing.w,
      sheet.facing.nw,
      sheet.takes,
      new Date().toISOString(),
    );

  return id;
}
