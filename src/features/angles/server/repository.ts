// Shots & Angles' tables (`angles/001-angle-sets.sql`): a set's identity, request key, character
// and seed, its views' generation references in order, and the library characters saved from
// them. Generations are the generation service's; nothing here writes one.
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { database } from "../../../shared/server/db.server.ts";
import { type AngleView, angleViewSchema } from "../contracts.ts";

const setRowSchema = z.object({
  access_code_id: z.string(),
  character_id: z.uuid(),
  created_at: z.iso.datetime(),
  id: z.uuid(),
  request_key: z.string(),
  seed: z.int().nonnegative(),
});

type SetRow = z.output<typeof setRowSchema>;

const viewRowSchema = z.object({
  generation_id: z.uuid(),
  position: z.int().nonnegative(),
  reused: z.int().transform((value) => value === 1),
  view: angleViewSchema,
});

export type ViewRow = z.output<typeof viewRowSchema>;

function oneSet(where: "id" | "request_key", value: string): SetRow | null {
  const row = database.prepare(`SELECT * FROM angle_sets WHERE ${where} = ?`).get(value);

  return row ? setRowSchema.parse(row) : null;
}

/** The set a request key admitted, `null` for a key no set has. */
export function findSetByKey(requestKey: string) {
  return oneSet("request_key", requestKey);
}

export function findSet(id: string) {
  return oneSet("id", id);
}

/** A set's views, in order. */
export function findViews(setId: string) {
  const rows = database
    .prepare(
      "SELECT position, view, generation_id, reused FROM angle_set_items WHERE set_id = ? ORDER BY position",
    )
    .all(setId);

  return z.array(viewRowSchema).parse(rows);
}

/**
 * Stores a set and its views, each with the generation `submitMany` answered for it. The caller
 * runs it in the transaction that admitted them, so a set exists exactly when its generations do.
 */
export function insertSet(set: {
  accessCodeId: string;
  characterId: string;
  requestKey: string;
  seed: number;
  views: ReadonlyArray<{ generationId: string; reused: boolean; view: AngleView }>;
}) {
  const id = randomUUID();

  database
    .prepare(
      "INSERT INTO angle_sets (id, request_key, access_code_id, character_id, seed, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, set.requestKey, set.accessCodeId, set.characterId, set.seed, new Date().toISOString());

  const insertView = database.prepare(
    "INSERT INTO angle_set_items (set_id, position, view, generation_id, reused) VALUES (?, ?, ?, ?, ?)",
  );

  set.views.forEach(({ generationId, reused, view }, position) => {
    insertView.run(id, position, view, generationId, reused ? 1 : 0);
  });

  return id;
}

/** The workspace's sets, most recent first (at most `limit`). */
export function listSets(limit: number) {
  const rows = database
    .prepare("SELECT * FROM angle_sets ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit);

  return z.array(setRowSchema).parse(rows);
}

/** The library character saved from a view's generation, `null` until one is. */
export function findSavedCharacter(generationId: string) {
  const row = database
    .prepare("SELECT character_id FROM angle_view_characters WHERE generation_id = ?")
    .get(generationId);

  return row ? z.object({ character_id: z.uuid() }).parse(row).character_id : null;
}

/** Records the character a view's generation was saved as (the first one stays). */
export function recordSavedCharacter(generationId: string, characterId: string) {
  database
    .prepare(
      "INSERT INTO angle_view_characters (generation_id, character_id) VALUES (?, ?) ON CONFLICT (generation_id) DO NOTHING",
    )
    .run(generationId, characterId);
}
