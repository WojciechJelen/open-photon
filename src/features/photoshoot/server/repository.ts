// The photoshoot feature's tables (`photoshoot/001-photoshoots.sql`): a photoshoot's identity,
// its request key, its character and setting, and its shots' generation references in order.
// Generations themselves are the generation service's; nothing here writes one.
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { database } from "../../../shared/server/db.server.ts";
import { photoshootSettingSchema } from "../contracts.ts";

const photoshootRowSchema = z.object({
  access_code_id: z.string(),
  character_id: z.uuid(),
  created_at: z.iso.datetime(),
  id: z.uuid(),
  request_key: z.string(),
  setting: photoshootSettingSchema,
});

export type PhotoshootRow = z.output<typeof photoshootRowSchema>;

const itemRowsSchema = z.array(
  z.object({
    generation_id: z.uuid(),
    position: z.int().nonnegative(),
    reused: z.int().transform((value) => value === 1),
  }),
);

export type PhotoshootItemRow = z.output<typeof itemRowsSchema>[number];

function photoshootWhere(column: "id" | "request_key", value: string) {
  const row = database.prepare(`SELECT * FROM photoshoots WHERE ${column} = ?`).get(value);

  return row ? photoshootRowSchema.parse(row) : null;
}

/** The photoshoot a request key admitted, `null` for a key none has. */
export const findPhotoshootByKey = (requestKey: string) =>
  photoshootWhere("request_key", requestKey);

export const findPhotoshoot = (id: string) => photoshootWhere("id", id);

/** A photoshoot's shots, in order. */
export function findShots(photoshootId: string) {
  return itemRowsSchema.parse(
    database
      .prepare(
        "SELECT position, generation_id, reused FROM photoshoot_items WHERE photoshoot_id = ? ORDER BY position",
      )
      .all(photoshootId),
  );
}

/**
 * Stores a photoshoot and its shots, each with the generation `submitMany` answered for it. The
 * caller runs it in the transaction that admitted them, so a photoshoot exists exactly when its
 * generations do.
 */
export function insertPhotoshoot(photoshoot: {
  accessCodeId: string;
  characterId: string;
  requestKey: string;
  setting: PhotoshootRow["setting"];
  shots: ReadonlyArray<{ generationId: string; reused: boolean }>;
}) {
  const id = randomUUID();

  database
    .prepare(
      "INSERT INTO photoshoots (id, request_key, access_code_id, character_id, setting, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      photoshoot.requestKey,
      photoshoot.accessCodeId,
      photoshoot.characterId,
      photoshoot.setting,
      new Date().toISOString(),
    );

  const insertShot = database.prepare(
    "INSERT INTO photoshoot_items (photoshoot_id, position, generation_id, reused) VALUES (?, ?, ?, ?)",
  );

  for (const [position, shot] of photoshoot.shots.entries()) {
    insertShot.run(id, position, shot.generationId, shot.reused ? 1 : 0);
  }

  return id;
}

/** The workspace's photoshoots, most recent first (at most `limit`). */
export function listPhotoshoots(limit: number) {
  return z
    .array(photoshootRowSchema)
    .parse(
      database
        .prepare("SELECT * FROM photoshoots ORDER BY created_at DESC, id DESC LIMIT ?")
        .all(limit),
    );
}
