import { randomUUID } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";

import { z } from "zod";

import { database } from "./db.server.ts";
import { type Recipe, recipeHash, recipeSchema } from "./recipe.ts";
import { motionTransferParamsSchema } from "./workflows/params.ts";

const statusSchema = z.enum([
  "preparing",
  "queued",
  "running",
  "finalizing",
  "done",
  "failed",
  "unknown",
]);

type GenerationStatus = z.infer<typeof statusSchema>;

/**
 * `preparing → queued → running → finalizing → done | failed`. Comfy can finish a job without
 * ever reporting `running`, so `queued` may go straight to `finalizing`. `unknown` is a crash
 * between `submit()` and `markQueued`: the job may exist, so the row is never resubmitted.
 */
const nextStatuses: Record<GenerationStatus, readonly GenerationStatus[]> = {
  done: [],
  failed: [],
  finalizing: ["done", "failed"],
  preparing: ["queued", "failed", "unknown"],
  queued: ["running", "finalizing", "failed"],
  running: ["finalizing", "failed"],
  unknown: [],
};

function jsonColumn<T extends z.ZodType>(schema: T) {
  return z.codec(z.string(), schema, {
    decode: (text) => JSON.parse(text),
    encode: (value) => JSON.stringify(value),
  });
}

const recipeColumn = jsonColumn(recipeSchema);

const generationRowSchema = z.object({
  access_code_id: z.string().nullable(),
  character_id: z.string().nullable(),
  client_hash: z.string().nullable(),
  created_at: z.iso.datetime(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  final_asset_id: z.string().nullable(),
  finalize_attempts: z.int().nonnegative(),
  finished_at: z.iso.datetime().nullable(),
  id: z.uuid(),
  idempotency_key: z.uuid(),
  is_prerendered: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1),
  kind: z.enum(["render", "character"]),
  motion_id: z.string().nullable(),
  output_asset_id: z.string().nullable(),
  parent_id: z.uuid().nullable(),
  poster_asset_id: z.string().nullable(),
  progress: z.int().min(0).max(100).nullable(),
  // The `asReference()` values of the files uploaded to the provider, to rebuild the graph.
  provider_inputs: jsonColumn(
    motionTransferParamsSchema.pick({ driving_video: true, reference_image: true }),
  ).nullable(),
  provider_job_id: z.string().min(1).nullable(),
  recipe: recipeColumn,
  recipe_hash: z.string().regex(/^[a-f0-9]{64}$/),
  share_slug: z.string().nullable(),
  status: statusSchema,
  submitted_at: z.iso.datetime().nullable(),
  target: recipeSchema.shape.target,
  workflow_id: z.string().min(1),
  workflow_version: z.int().positive(),
});

function parseRow(row: Record<string, SQLOutputValue> | undefined) {
  return row === undefined ? null : generationRowSchema.parse(row);
}

/** Inserts a `preparing` row whose idempotency key exists before anything reaches the provider. */
export function createGeneration({ parentId, recipe }: { parentId?: string; recipe: Recipe }) {
  const row = database
    .prepare(
      `INSERT INTO generations (id, parent_id, kind, workflow_id, workflow_version, recipe,
        recipe_hash, idempotency_key, target, status, created_at)
      VALUES (?, ?, 'render', ?, ?, ?, ?, ?, ?, 'preparing', ?)
      RETURNING *`,
    )
    .get(
      randomUUID(),
      parentId ?? null,
      recipe.workflow.id,
      recipe.workflow.version,
      z.encode(recipeColumn, recipe),
      recipeHash(recipe),
      randomUUID(),
      recipe.target,
      new Date().toISOString(),
    );

  return generationRowSchema.parse(row);
}

/** A finished generation with this recipe, whose output can be shown instead of rendering again. */
export function findReusable(hash: string) {
  return parseRow(
    database
      .prepare(
        `SELECT * FROM generations WHERE recipe_hash = ? AND status = 'done'
        ORDER BY finished_at DESC LIMIT 1`,
      )
      .get(hash),
  );
}

/** Stores the provider job id the instant `submit()` returns. */
export function markQueued(id: string, providerJobId: string) {
  const row = parseRow(
    database
      .prepare(
        `UPDATE generations SET status = 'queued', provider_job_id = ?, submitted_at = ?
        WHERE id = ? AND status = 'preparing'
        RETURNING *`,
      )
      .get(providerJobId, new Date().toISOString(), id),
  );

  if (!row) {
    throw new Error(`Generation ${id} is not preparing`);
  }

  return row;
}

/** Moves a row from `from` to `to` if the state machine allows it and the row is still in `from`. */
export function transition(id: string, from: GenerationStatus, to: GenerationStatus) {
  if (!nextStatuses[from].includes(to)) {
    throw new Error(`A generation cannot go from ${from} to ${to}`);
  }

  const finishedAt = to === "done" || to === "failed" ? new Date().toISOString() : null;

  const row = parseRow(
    database
      .prepare(
        `UPDATE generations SET status = ?, finished_at = coalesce(?, finished_at)
        WHERE id = ? AND status = ?
        RETURNING *`,
      )
      .get(to, finishedAt, id, from),
  );

  if (!row) {
    throw new Error(`Generation ${id} is not ${from}`);
  }

  return row;
}

/** For a row left `preparing` by a crash after `submit()` may have reached the provider. */
export function markUnknown(id: string) {
  return transition(id, "preparing", "unknown");
}
