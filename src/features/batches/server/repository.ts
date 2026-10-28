// The batches feature's tables (`batches/001-batches.sql`): a batch's identity, its request key
// and its items' generation references, in order. Generations themselves are the generation
// service's; nothing here writes one.
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { database } from "../../../shared/server/db.server.ts";
import type { DraftSnapshot } from "../../motionTransfer/api.ts";
import type { BatchItem, BatchKind } from "../contracts.ts";

const json = <T extends z.ZodType>(schema: T) =>
  z.codec(z.string(), schema, {
    decode: (text) => JSON.parse(text),
    encode: (value) => JSON.stringify(value),
  });

const batchRowSchema = z.object({
  access_code_id: z.string(),
  created_at: z.iso.datetime(),
  id: z.uuid(),
  kind: z.enum(["seeds", "characters"]),
  request_key: z.string(),
  shot: json(z.record(z.string(), z.union([z.string(), z.number()]))),
});

export type BatchRow = z.output<typeof batchRowSchema>;

const itemRowSchema = z.object({
  generation_id: z.uuid(),
  position: z.int().nonnegative(),
  reused: z.int().transform((value) => value === 1),
  variation: json(
    z.union([
      z.object({ seed: z.int().nonnegative() }).strict(),
      z.object({ character_id: z.uuid() }).strict(),
    ]),
  ),
});

export type ItemRow = z.output<typeof itemRowSchema>;

/** The batch a request key admitted, `null` for a key no batch has. */
export function findBatchByKey(requestKey: string) {
  const row = database.prepare("SELECT * FROM batches WHERE request_key = ?").get(requestKey);

  return row ? batchRowSchema.parse(row) : null;
}

export function findBatch(id: string) {
  const row = database.prepare("SELECT * FROM batches WHERE id = ?").get(id);

  return row ? batchRowSchema.parse(row) : null;
}

/** A batch's items, in order. */
export function findItems(batchId: string) {
  return z
    .array(itemRowSchema)
    .parse(
      database
        .prepare(
          "SELECT position, generation_id, variation, reused FROM batch_items WHERE batch_id = ? ORDER BY position",
        )
        .all(batchId),
    );
}

/**
 * Stores a batch and its items, each with the generation `submitMany` answered for it. The caller
 * runs it in the transaction that admitted them, so a batch exists exactly when its generations do.
 */
export function insertBatch(batch: {
  accessCodeId: string;
  items: ReadonlyArray<{
    generationId: string;
    reused: boolean;
    variation: BatchItem["variation"];
  }>;
  kind: BatchKind;
  requestKey: string;
  shot: DraftSnapshot;
}) {
  const id = randomUUID();

  database
    .prepare(
      "INSERT INTO batches (id, request_key, access_code_id, kind, shot, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      batch.requestKey,
      batch.accessCodeId,
      batch.kind,
      JSON.stringify(batch.shot),
      new Date().toISOString(),
    );

  const insertItem = database.prepare(
    "INSERT INTO batch_items (batch_id, position, generation_id, variation, reused) VALUES (?, ?, ?, ?, ?)",
  );

  for (const [position, item] of batch.items.entries()) {
    insertItem.run(
      id,
      position,
      item.generationId,
      JSON.stringify(item.variation),
      item.reused ? 1 : 0,
    );
  }

  return id;
}

/** The workspace's batches, most recent first (at most `limit`). */
export function listBatches(limit: number) {
  return z
    .array(batchRowSchema)
    .parse(
      database
        .prepare("SELECT * FROM batches ORDER BY created_at DESC, id DESC LIMIT ?")
        .all(limit),
    );
}
