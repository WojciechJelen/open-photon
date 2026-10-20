import { randomBytes, randomUUID } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";

import { z } from "zod";

import { generationSchema, type generationStatusSchema } from "../lib/contracts.ts";
import { database } from "./db.server.ts";
import { type Recipe, recipeHash, recipeSchema } from "./recipe.ts";
import { motionTransferParamsSchema } from "./workflows/params.ts";

type GenerationStatus = z.infer<typeof generationStatusSchema>;

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

const providerInputsColumn = jsonColumn(
  motionTransferParamsSchema.pick({ driving_video: true, reference_image: true }),
);

type ProviderInputs = z.output<typeof providerInputsColumn>;

const generationRowSchema = generationSchema.extend({
  access_code_id: z.string().nullable(),
  client_hash: z.string().nullable(),
  finalize_attempts: z.int().nonnegative(),
  idempotency_key: z.uuid(),
  is_prerendered: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1),
  kind: z.enum(["render", "character"]),
  motion_id: z.string().nullable(),
  output_asset_id: z.uuid().nullable(),
  // The `asReference()` values of the files uploaded to the provider, to rebuild the graph.
  provider_inputs: providerInputsColumn.nullable(),
  provider_job_id: z.string().min(1).nullable(),
  recipe: recipeColumn,
  recipe_hash: z.string().regex(/^[a-f0-9]{64}$/),
  target: recipeSchema.shape.target,
  workflow_id: z.string().min(1),
  workflow_version: z.int().positive(),
});

export type Generation = z.output<typeof generationRowSchema>;

function parseRow(row: Record<string, SQLOutputValue> | undefined) {
  return row === undefined ? null : generationRowSchema.parse(row);
}

/**
 * Inserts a `preparing` row whose idempotency key exists before anything reaches the provider,
 * with the access code that asked for it (which counts it, `006-access-codes.sql`).
 */
export function createGeneration({
  accessCodeId,
  characterId,
  parentId,
  recipe,
}: {
  accessCodeId?: string;
  characterId?: string;
  parentId?: string;
  recipe: Recipe;
}) {
  const row = database
    .prepare(
      `INSERT INTO generations (id, parent_id, kind, character_id, workflow_id, workflow_version,
        recipe, recipe_hash, idempotency_key, target, status, access_code_id, created_at)
      VALUES (?, ?, 'render', ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?)
      RETURNING *`,
    )
    .get(
      randomUUID(),
      parentId ?? null,
      characterId ?? null,
      recipe.workflow.id,
      recipe.workflow.version,
      z.encode(recipeColumn, recipe),
      recipeHash(recipe),
      randomUUID(),
      recipe.target,
      accessCodeId ?? null,
      new Date().toISOString(),
    );

  return generationRowSchema.parse(row);
}

export function findGeneration(id: string) {
  return parseRow(database.prepare("SELECT * FROM generations WHERE id = ?").get(id));
}

/** The done generation whose share page is `/r/<slug>`. */
export function findShared(slug: string) {
  return parseRow(
    database
      .prepare("SELECT * FROM generations WHERE share_slug = ? AND status = 'done'")
      .get(slug),
  );
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

/**
 * A generation with this recipe that may still produce its output: on its way, or `unknown`
 * (Comfy may be rendering it). Submitting the recipe again would pay for a second job.
 */
export function findPending(hash: string) {
  return parseRow(
    database
      .prepare(
        `SELECT * FROM generations WHERE recipe_hash = ?
          AND status IN ('preparing', 'queued', 'running', 'finalizing', 'unknown')
        ORDER BY created_at DESC LIMIT 1`,
      )
      .get(hash),
  );
}

const IN_FLIGHT = "status IN ('preparing', 'queued', 'running', 'finalizing')";

/**
 * How many generations are in flight: being submitted, or on Comfy and not finished yet. The
 * in-flight cap (`IN_FLIGHT_MAX`) counts them; `unknown` ones are not counted, as nothing ever
 * moves them on.
 */
export function countInFlight() {
  return Number(
    database.prepare(`SELECT count(*) AS count FROM generations WHERE ${IN_FLIGHT}`).get()?.count,
  );
}

/** The ids of the `limit` oldest generations in flight. */
export function findInFlight(limit: number) {
  return database
    .prepare(`SELECT id FROM generations WHERE ${IN_FLIGHT} ORDER BY created_at LIMIT ?`)
    .all(limit)
    .map((row) => String(row.id));
}

/** Keeps the provider's references to the uploaded files, before the graph that uses them is sent. */
export function recordProviderInputs(id: string, inputs: ProviderInputs) {
  database
    .prepare("UPDATE generations SET provider_inputs = ? WHERE id = ? AND status = 'preparing'")
    .run(z.encode(providerInputsColumn, inputs), id);
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

/** Comfy reports the job running, with `progress` (0–99) when it says how far it is. */
export function markRunning(id: string, progress: number | null) {
  return parseRow(
    database
      .prepare(
        `UPDATE generations SET status = 'running', progress = coalesce(?, progress)
        WHERE id = ? AND status IN ('queued', 'running')
        RETURNING *`,
      )
      .get(progress, id),
  );
}

type Outcome = Partial<
  Pick<
    Generation,
    "error_code" | "error_message" | "final_asset_id" | "output_asset_id" | "poster_asset_id"
  >
>;

/**
 * Moves a row from `from` to `to` if the state machine allows it and the row is still in `from`,
 * storing the error or the output assets that come with the new status. A row that becomes
 * `done` gets its `share_slug` (`/r/<slug>`): 16 random hex characters, 64 bits nobody can guess.
 */
export function transition(
  id: string,
  from: GenerationStatus,
  to: GenerationStatus,
  outcome: Outcome = {},
) {
  if (!nextStatuses[from].includes(to)) {
    throw new Error(`A generation cannot go from ${from} to ${to}`);
  }

  const finishedAt = to === "done" || to === "failed" ? new Date().toISOString() : null;
  const shareSlug = to === "done" ? randomBytes(8).toString("hex") : null;

  const row = parseRow(
    database
      .prepare(
        `UPDATE generations SET status = ?, finished_at = coalesce(?, finished_at),
          progress = CASE WHEN ? = 'done' THEN 100 ELSE progress END,
          error_code = coalesce(?, error_code), error_message = coalesce(?, error_message),
          output_asset_id = coalesce(?, output_asset_id),
          final_asset_id = coalesce(?, final_asset_id),
          poster_asset_id = coalesce(?, poster_asset_id),
          share_slug = coalesce(share_slug, ?)
        WHERE id = ? AND status = ?
        RETURNING *`,
      )
      .get(
        to,
        finishedAt,
        to,
        outcome.error_code ?? null,
        outcome.error_message ?? null,
        outcome.output_asset_id ?? null,
        outcome.final_asset_id ?? null,
        outcome.poster_asset_id ?? null,
        shareSlug,
        id,
        from,
      ),
  );

  if (!row) {
    throw new Error(`Generation ${id} is not ${from}`);
  }

  return row;
}

/** For a row left `preparing` by a crash after `submit()` may have reached the provider. */
export function markUnknown(id: string, outcome: Outcome = {}) {
  return transition(id, "preparing", "unknown", outcome);
}

/** Counts a finalize that failed (a download or FFmpeg error); the next read tries again. */
export function countFinalizeAttempt(id: string) {
  database
    .prepare("UPDATE generations SET finalize_attempts = finalize_attempts + 1 WHERE id = ?")
    .run(id);
}
