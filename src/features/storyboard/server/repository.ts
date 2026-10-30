// The storyboard feature's tables (`storyboard/001-storyboards.sql`): a storyboard's text, its
// cards' saved descriptions and the generations each card was rendered as. Generations themselves
// are the generation service's; nothing here writes one.
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { database } from "../../../shared/server/db.server.ts";
import { CARD_COUNT, type StoryboardStyle, storyboardStyles } from "../contracts.ts";

const storyboardRowSchema = z.object({
  access_code_id: z.string(),
  character_id: z.uuid(),
  created_at: z.iso.datetime(),
  id: z.uuid(),
  request_key: z.string(),
  scenes_generation_id: z.uuid().nullable(),
  seed: z.int().nonnegative(),
  sequence: z.string(),
  style: z.enum(storyboardStyles),
  title: z.string().nullable(),
  updated_at: z.iso.datetime(),
});

export type StoryboardRow = z.output<typeof storyboardRowSchema>;

const cardGenerationRowSchema = z.object({
  description: z.string(),
  generation_id: z.uuid(),
  position: z.int().min(0),
  request_key: z.string(),
  seed: z.int().nonnegative(),
});

export type CardGenerationRow = z.output<typeof cardGenerationRowSchema>;

/** The storyboard a request key made, `null` for a key no storyboard has. */
export function findStoryboardByKey(requestKey: string) {
  const row = database.prepare("SELECT * FROM storyboards WHERE request_key = ?").get(requestKey);

  return row ? storyboardRowSchema.parse(row) : null;
}

export function findStoryboard(id: string) {
  const row = database.prepare("SELECT * FROM storyboards WHERE id = ?").get(id);

  return row ? storyboardRowSchema.parse(row) : null;
}

/** The workspace's storyboards, most recently changed first (at most `limit`). */
export function listStoryboards(limit: number) {
  return z
    .array(storyboardRowSchema)
    .parse(
      database
        .prepare("SELECT * FROM storyboards ORDER BY updated_at DESC, id DESC LIMIT ?")
        .all(limit),
    );
}

/**
 * Stores a storyboard with its four cards: `descriptions` when the scenes were written by hand,
 * else every description `null` (the split's scenes show until one is saved).
 */
export function insertStoryboard(storyboard: {
  accessCodeId: string;
  characterId: string;
  descriptions: readonly string[] | null;
  requestKey: string;
  scenesGenerationId: string | null;
  seed: number;
  sequence: string;
  style: StoryboardStyle;
  title: string | null;
}) {
  const id = randomUUID();
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO storyboards (id, request_key, access_code_id, character_id, title, sequence, seed,
        style, scenes_generation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      storyboard.requestKey,
      storyboard.accessCodeId,
      storyboard.characterId,
      storyboard.title,
      storyboard.sequence,
      storyboard.seed,
      storyboard.style,
      storyboard.scenesGenerationId,
      now,
      now,
    );

  const insertCard = database.prepare(
    "INSERT INTO storyboard_cards (storyboard_id, position, description) VALUES (?, ?, ?)",
  );

  for (let position = 0; position < CARD_COUNT; position += 1) {
    insertCard.run(id, position, storyboard.descriptions?.[position] ?? null);
  }

  return id;
}

/** Each card's saved description, in order; `null` for one never saved. */
export function findDescriptions(storyboardId: string) {
  const rows = z
    .array(z.object({ description: z.string().nullable(), position: z.int() }))
    .parse(
      database
        .prepare(
          "SELECT position, description FROM storyboard_cards WHERE storyboard_id = ? ORDER BY position",
        )
        .all(storyboardId),
    );

  return Array.from(
    { length: CARD_COUNT },
    (_, position) => rows.find((row) => row.position === position)?.description ?? null,
  );
}

/**
 * Saves the title, the style and every card's description (`null`: not saved, as a new card), and
 * marks the storyboard changed.
 */
export function saveStoryboard(
  storyboardId: string,
  {
    descriptions,
    style,
    title,
  }: { descriptions: readonly (string | null)[]; style: StoryboardStyle; title: string | null },
) {
  const update = database.prepare(
    "UPDATE storyboard_cards SET description = ? WHERE storyboard_id = ? AND position = ?",
  );

  for (const [position, description] of descriptions.entries()) {
    update.run(description, storyboardId, position);
  }

  database
    .prepare("UPDATE storyboards SET title = ?, style = ?, updated_at = ? WHERE id = ?")
    .run(title, style, new Date().toISOString(), storyboardId);
}

/** Every generation each card was rendered as, oldest first. */
export function findCardGenerations(storyboardId: string) {
  return z.array(cardGenerationRowSchema).parse(
    database
      .prepare(
        `SELECT position, generation_id, request_key, description, seed
          FROM storyboard_card_generations WHERE storyboard_id = ?
          ORDER BY created_at, rowid`,
      )
      .all(storyboardId),
  );
}

/** The storyboard a card generations request with this key was stored for, else `null`. */
export function findCardRequest(requestKey: string) {
  const row = database
    .prepare("SELECT storyboard_id FROM storyboard_card_generations WHERE request_key = ? LIMIT 1")
    .get(requestKey);

  return row ? z.object({ storyboard_id: z.uuid() }).parse(row).storyboard_id : null;
}

/**
 * Records the generation each named card is rendered as now, under the request's key. The caller
 * runs it in the transaction that admitted them, so a card points at a generation exactly when
 * that generation exists.
 */
export function insertCardGenerations(
  storyboardId: string,
  requestKey: string,
  cards: ReadonlyArray<{
    description: string;
    generationId: string;
    position: number;
    seed: number;
  }>,
) {
  const now = new Date().toISOString();

  const insert = database.prepare(
    `INSERT INTO storyboard_card_generations
      (storyboard_id, position, generation_id, request_key, description, seed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const card of cards) {
    insert.run(
      storyboardId,
      card.position,
      card.generationId,
      requestKey,
      card.description,
      card.seed,
      now,
    );
  }

  // The storyboard moves to the top of the list.
  database.prepare("UPDATE storyboards SET updated_at = ? WHERE id = ?").run(now, storyboardId);
}
