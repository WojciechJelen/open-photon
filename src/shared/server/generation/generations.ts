import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SQLOutputValue } from "node:sqlite";

import { z } from "zod";

import {
  assetSchema,
  type GenerationOutput,
  generationSchema,
  type GenerationSnapshotOutput,
  type generationStatusSchema,
} from "../../contracts.ts";
import { findAsset, type StoredAsset } from "../assets.ts";
import { assetReferenceSchema } from "../comfy-assets.ts";
import type { ProviderTarget } from "../comfy-target.ts";
import { database } from "../db.server.ts";
import { transaction } from "../migrate.ts";
import { assetsDirectory } from "../paths.ts";
import {
  recipeIdentitySchema,
  type WorkflowDefinition,
  type WorkflowRecipe,
  workflows,
} from "./definition.ts";
import { GenerateError } from "./errors.ts";
import { recipeHash } from "./recipe-hash.ts";

type GenerationStatus = z.infer<typeof generationStatusSchema>;

/**
 * `waiting → preparing → queued → running → finalizing → done | failed`. `waiting` is in line
 * for a place in flight (`IN_FLIGHT_MAX`): the dispatcher claims it (`preparing`), or it is
 * `cancelled`. A `preparing` row goes back to `waiting` only when a restart finds it was never
 * handed to the provider (`releaseClaim`). Comfy can finish a job without ever reporting
 * `running`, so `queued` may go straight to `finalizing`. `unknown` is a crash between `submit()`
 * and `markQueued`: the job may exist, so the row is never resubmitted.
 */
const nextStatuses: Record<GenerationStatus, readonly GenerationStatus[]> = {
  cancelled: [],
  done: [],
  failed: [],
  finalizing: ["done", "failed"],
  preparing: ["queued", "failed", "unknown", "waiting"],
  queued: ["running", "finalizing", "failed"],
  running: ["finalizing", "failed"],
  unknown: [],
  waiting: ["preparing", "cancelled"],
};

/**
 * This process, as `claimed_by` records it on the rows it takes out of the queue: its pid and a
 * random suffix, as a pid is reused after a restart.
 */
const CLAIMANT = `${process.pid}-${randomBytes(4).toString("hex")}`;

const queueListeners = new Set<() => void>();

/**
 * Calls `listener` (synchronously, so it should only schedule work) after a row joins the queue
 * or changes status: a place in flight may have opened, or a row may be waiting for one. Returns
 * the function that stops it. The dispatcher (`dispatcher.ts`) wakes on it.
 */
export function onQueueChange(listener: () => void) {
  queueListeners.add(listener);

  return () => {
    queueListeners.delete(listener);
  };
}

function queueChanged() {
  for (const listener of queueListeners) {
    listener();
  }
}

function jsonColumn<T extends z.ZodType>(schema: T) {
  return z.codec(z.string(), schema, {
    decode: (text) => JSON.parse(text),
    encode: (value) => JSON.stringify(value),
  });
}

// The recipe as stored: a JSON object only its workflow's definition decodes (`recipeSchema`).
const recipeColumn = jsonColumn(z.record(z.string(), z.json()));

// The `asReference()` values of the files uploaded to the provider, by the names the workflow's
// `assetInputs` gives them, to rebuild the graph.
const providerInputsColumn = jsonColumn(z.record(z.string(), assetReferenceSchema));

type ProviderInputs = z.output<typeof providerInputsColumn>;

// A row as stored: everything the API shows but `position` and `outputs` (`snapshot` adds them).
const generationRowSchema = generationSchema.omit({ outputs: true, position: true }).extend({
  access_code_id: z.string().nullable(),
  // `<request key>` of the multi-item request that made it (`submitMany`).
  batch_key: z.string().nullable(),
  // When a process took it to submit (`waiting → preparing`, or created it `preparing`), and
  // which one (`CLAIMANT`).
  claimed_at: z.iso.datetime().nullable(),
  claimed_by: z.string().nullable(),
  finalize_attempted_at: z.iso.datetime().nullable(),
  finalize_attempts: z.int().nonnegative(),
  idempotency_key: z.uuid(),
  is_prerendered: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1),
  // The sample motion whose clip drives it, if it is one (`createGeneration`).
  motion_id: z.string().nullable(),
  provider_inputs: providerInputsColumn.nullable(),
  provider_job_id: z.string().min(1).nullable(),
  recipe: recipeColumn,
  recipe_hash: z.string().regex(/^[a-f0-9]{64}$/),
  // The client's key for the request that made it: `<key>`, or `<key>#<index>` for an item of a
  // multi-item request.
  request_key: z.string().nullable(),
  // When the graph was handed to the provider: from then on the job may exist there.
  submit_started_at: z.iso.datetime().nullable(),
  // The endpoint the job runs on (`ProviderTarget`): `target_origin` is null on Cloud, and on a
  // self-hosted row stored before origins were recorded.
  target: z.enum(["cloud", "selfhost"]),
  target_origin: z.string().nullable(),
  workflow_id: z.string().min(1),
  workflow_version: z.int().positive(),
});

export type Generation = z.output<typeof generationRowSchema>;

/** A generation with its recipe decoded by its workflow's definition (`recipeSchema`). */
export type DecodedGeneration<Recipe> = Omit<Generation, "recipe"> & { recipe: Recipe };

function parseRow(row: Record<string, SQLOutputValue> | undefined) {
  return row === undefined ? null : generationRowSchema.parse(row);
}

/**
 * The recipe `definition` decodes from `recipe`, and its hash (`recipeHash`, canonical JSON of the
 * decoded value). Every recipe carries its identity (`recipeIdentitySchema`: target, workflow,
 * model pins), checked here before it is hashed: one naming another workflow or version than
 * `definition`'s throws, so two workflows can never share a recipe hash.
 */
export function hashRecipe<Input, Recipe extends WorkflowRecipe>(
  definition: WorkflowDefinition<Input, Recipe>,
  recipe: Recipe,
) {
  const parsed = definition.recipeSchema.parse(recipe);
  const { workflow } = recipeIdentitySchema.parse(parsed);

  if (workflow.id !== definition.id || workflow.version !== definition.version) {
    throw new Error(
      `A ${definition.id} v${definition.version} recipe names workflow ${workflow.id} v${workflow.version}`,
    );
  }

  return { hash: recipeHash(parsed), recipe: parsed };
}

/**
 * Inserts a row whose idempotency key exists before anything reaches the provider, for
 * `definition`'s workflow and the recipe it decodes (`hashRecipe`), on `target`, with the access
 * code that asked for it (which counts it, `006-access-codes.sql`), the rows it links to
 * (`characterId`, the sample `motionId`) and the client's request key (`requestKey`, and
 * `batchKey` for an item of a multi-item request). It is `preparing`, claimed by this process
 * (`CLAIMANT`), unless it is `waiting` in line for a place in flight. The row comes back with
 * that recipe. A request key the workflow already has throws (`generations_request_key`).
 */
export function createGeneration<Input, Recipe extends WorkflowRecipe>(
  definition: WorkflowDefinition<Input, Recipe>,
  {
    accessCodeId,
    batchKey,
    characterId,
    motionId,
    parentId,
    recipe,
    requestKey,
    status = "preparing",
    target,
  }: {
    accessCodeId?: string;
    batchKey?: string;
    characterId?: string;
    motionId?: string;
    parentId?: string;
    recipe: Recipe;
    requestKey?: string;
    status?: "preparing" | "waiting";
    target: ProviderTarget;
  },
): DecodedGeneration<Recipe> {
  const { hash, recipe: parsed } = hashRecipe(definition, recipe);
  const now = new Date().toISOString();
  const claimed = status === "preparing";

  const row = database
    .prepare(
      `INSERT INTO generations (id, parent_id, motion_id, character_id, workflow_id,
        workflow_version, recipe, recipe_hash, idempotency_key, target, target_origin, status,
        access_code_id, created_at, claimed_at, claimed_by, request_key, batch_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
    )
    .get(
      randomUUID(),
      parentId ?? null,
      motionId ?? null,
      characterId ?? null,
      definition.id,
      definition.version,
      JSON.stringify(parsed),
      hash,
      randomUUID(),
      target.kind,
      target.origin,
      status,
      accessCodeId ?? null,
      now,
      claimed ? now : null,
      claimed ? CLAIMANT : null,
      requestKey ?? null,
      batchKey ?? null,
    );

  if (!claimed) {
    queueChanged();
  }

  return { ...generationRowSchema.parse(row), recipe: parsed };
}

export function findGeneration(id: string) {
  return parseRow(database.prepare("SELECT * FROM generations WHERE id = ?").get(id));
}

/**
 * A generation followed through each failed or cancelled one's newest child (`parent_id`: the
 * shared retry, a new seed, or re-run, the same seed, wherever it was asked for) to its latest
 * attempt, with how many attempts that skipped; `null` when `generationId` is not stored. Features
 * that group generations (batches, photoshoots, angle sets, storyboards) show each item this way.
 */
export function findLatestAttempt(generationId: string) {
  let row = findGeneration(generationId);
  let attempt = 0;

  while (row?.status === "failed" || row?.status === "cancelled") {
    const child = database
      .prepare(
        "SELECT id FROM generations WHERE parent_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(row.id);

    const next = child ? findGeneration(z.object({ id: z.uuid() }).parse(child).id) : null;

    if (!next) {
      break;
    }

    row = next;
    attempt += 1;
  }

  return row ? { attempt, row } : null;
}

/** The done generation whose share page is `/r/<slug>`. */
export function findShared(slug: string) {
  return parseRow(
    database
      .prepare("SELECT * FROM generations WHERE share_slug = ? AND status = 'done'")
      .get(slug),
  );
}

/** Which workflow a recipe hash is looked up for: a hash identifies a recipe of one workflow. */
type WorkflowKey = { id: string; version: number };

/**
 * A finished generation of `workflow` with this recipe, whose output can be shown instead of
 * rendering again.
 */
export function findReusable(hash: string, workflow: WorkflowKey) {
  return parseRow(
    database
      .prepare(
        `SELECT * FROM generations WHERE recipe_hash = ? AND status = 'done'
          AND workflow_id = ? AND workflow_version = ?
        ORDER BY finished_at DESC LIMIT 1`,
      )
      .get(hash, workflow.id, workflow.version),
  );
}

// Comfy forgets an idempotency key a day after it was used, so after that an `unknown` row can no
// longer be told apart from a job that never existed.
const UNKNOWN_REUSE_MS = 24 * 60 * 60 * 1000;

/**
 * A generation of `workflow` with this recipe that may still produce its output: in line, on its
 * way, or `unknown` (Comfy may be rendering it) for up to a day. Submitting the recipe again
 * would pay for a second job; an `unknown` row older than that is left alone, so the recipe can
 * be generated again.
 */
export function findPending(hash: string, workflow: WorkflowKey) {
  return parseRow(
    database
      .prepare(
        `SELECT * FROM generations WHERE recipe_hash = ? AND workflow_id = ? AND workflow_version = ?
          AND (status IN ('waiting', 'preparing', 'queued', 'running', 'finalizing')
            OR (status = 'unknown' AND created_at > ?))
        ORDER BY created_at DESC LIMIT 1`,
      )
      .get(
        hash,
        workflow.id,
        workflow.version,
        new Date(Date.now() - UNKNOWN_REUSE_MS).toISOString(),
      ),
  );
}

const requestSchema = z.object({
  access_code_id: z.string().nullable(),
  generation_id: z.string(),
  reused: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1),
});

/**
 * What a client's request key for `workflowId` was answered with (`generation_requests`): the
 * generation, whether it was an existing one, and the access code that asked; `null` for a new key.
 */
export function findRequest(workflowId: string, requestKey: string) {
  const stored = database
    .prepare(
      `SELECT access_code_id, generation_id, reused FROM generation_requests
      WHERE workflow_id = ? AND request_key = ?`,
    )
    .get(workflowId, requestKey);

  const request = stored === undefined ? null : requestSchema.parse(stored);
  const row = request ? findGeneration(request.generation_id) : null;

  return request && row
    ? { accessCodeId: request.access_code_id, reused: request.reused, row }
    : null;
}

/**
 * Records what a request key was answered with: `generationId`, reused or made for it, for
 * `accessCodeId`. A key the workflow already has throws (its primary key).
 */
export function recordRequest(
  workflowId: string,
  requestKey: string,
  {
    accessCodeId,
    generationId,
    reused,
  }: { accessCodeId: string | null; generationId: string; reused: boolean },
) {
  database
    .prepare(
      `INSERT INTO generation_requests (workflow_id, request_key, access_code_id, generation_id,
        reused, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      workflowId,
      requestKey,
      accessCodeId,
      generationId,
      reused ? 1 : 0,
      new Date().toISOString(),
    );
}

// In flight on `target` (when given): a job on another endpoint cannot be followed from here
// (`failElsewhere`), so it never holds a place. A row from before origins were recorded matches
// by its kind.
const IN_FLIGHT = `status IN ('preparing', 'queued', 'running', 'finalizing')
  AND (:kind IS NULL OR (target = :kind AND (target_origin IS NULL OR target_origin IS :origin)))`;

const onTarget = (target: ProviderTarget | undefined) => ({
  kind: target?.kind ?? null,
  origin: target?.origin ?? null,
});

/**
 * How many generations are in flight on `target` (every endpoint without one): being submitted,
 * or on Comfy and not finished yet. The in-flight cap (`IN_FLIGHT_MAX`) counts them; `unknown`
 * ones are not counted, as nothing ever moves them on.
 */
export function countInFlight(target?: ProviderTarget) {
  return Number(
    database
      .prepare(`SELECT count(*) AS count FROM generations WHERE ${IN_FLIGHT}`)
      .get(onTarget(target))?.count,
  );
}

/** The ids of the `limit` oldest generations in flight on `target`. */
export function findInFlight(limit: number, target?: ProviderTarget) {
  return database
    .prepare(`SELECT id FROM generations WHERE ${IN_FLIGHT} ORDER BY created_at LIMIT :limit`)
    .all({ ...onTarget(target), limit })
    .map((row) => String(row.id));
}

// In line for `target` exactly: the endpoint a waiting row will be submitted to is the one its
// recipe was resolved for.
const WAITING_ON = "status = 'waiting' AND target = :kind AND target_origin IS :origin";

/** How many generations wait in line for `target`. */
export function countWaiting(target: ProviderTarget) {
  return Number(
    database
      .prepare(`SELECT count(*) AS count FROM generations WHERE ${WAITING_ON}`)
      .get(onTarget(target))?.count,
  );
}

/**
 * A `waiting` generation's place in line among those for its endpoint (1: the next one claimed),
 * by `created_at` and then insertion order, as `claimNextWaiting` takes them; `null` for any
 * other row.
 */
function queuePosition(row: Pick<Generation, "id" | "status">) {
  if (row.status !== "waiting") {
    return null;
  }

  return Number(
    database
      .prepare(
        `SELECT count(*) AS position FROM generations AS other
        JOIN generations AS self ON self.id = :id
        WHERE other.status = 'waiting' AND other.target = self.target
          AND other.target_origin IS self.target_origin
          AND (other.created_at < self.created_at
            OR (other.created_at = self.created_at AND other.rowid <= self.rowid))`,
      )
      .get({ id: row.id })?.position,
  );
}

/**
 * A row as the API shows it (`generationSchema`): a `waiting` one with its `position`, a `done`
 * one with every named output whose asset is stored: files with their asset, texts inline (at
 * most `TEXT_OUTPUT_MAX_BYTES`, which finalize enforces).
 */
export function snapshot(row: Omit<Generation, "recipe">) {
  return generationSchema.parse({
    ...row,
    outputs:
      row.status === "done"
        ? storedOutputs(row.id).map(({ name, stored }) => apiOutput(name, stored))
        : [],
    position: queuePosition(row),
  });
}

/**
 * Takes the oldest `waiting` generation for `target` out of the queue for this process
 * (`waiting → preparing`, `claimed_at`, `claimed_by` = `CLAIMANT`) while fewer than `max` are in
 * flight there, in one `BEGIN IMMEDIATE` transaction: the count and the claim see the same rows.
 * `null` when the line is empty or every place is taken.
 */
export function claimNextWaiting(target: ProviderTarget, max: number) {
  return transaction(database, () => {
    if (countInFlight(target) >= max) {
      return null;
    }

    return parseRow(
      database
        .prepare(
          `UPDATE generations SET status = 'preparing', claimed_at = :now, claimed_by = :claimant
          WHERE id = (SELECT id FROM generations WHERE ${WAITING_ON}
            ORDER BY created_at, rowid LIMIT 1)
          RETURNING *`,
        )
        .get({ ...onTarget(target), claimant: CLAIMANT, now: new Date().toISOString() }),
    );
  });
}

/**
 * Puts a `preparing` row that was never handed to the provider (no `submit_started_at`) back in
 * line (`preparing → waiting`), unclaimed, keeping its place (`created_at`) and its access code's
 * count. `null` when the row is not such a row any more.
 */
export function releaseClaim(id: string) {
  const row = parseRow(
    database
      .prepare(
        `UPDATE generations SET status = 'waiting', claimed_at = NULL, claimed_by = NULL
        WHERE id = ? AND status = 'preparing' AND submit_started_at IS NULL
        RETURNING *`,
      )
      .get(id),
  );

  if (row) {
    queueChanged();
  }

  return row;
}

/** The ids of the `waiting` generations that are not for `target`, oldest first. */
export function findWaitingElsewhere(target: ProviderTarget) {
  return database
    .prepare(
      `SELECT id FROM generations WHERE status = 'waiting'
        AND NOT (target = :kind AND target_origin IS :origin)
      ORDER BY created_at, rowid`,
    )
    .all(onTarget(target))
    .map((row) => String(row.id));
}

/** The ids of the generations that have a provider job and are not finished, oldest first. */
export function findFollowable() {
  return database
    .prepare(
      `SELECT id FROM generations
      WHERE status IN ('queued', 'running', 'finalizing') AND provider_job_id IS NOT NULL
      ORDER BY created_at`,
    )
    .all()
    .map((row) => String(row.id));
}

/** The ids of the `preparing` generations, oldest first. */
export function findPreparing() {
  return database
    .prepare("SELECT id FROM generations WHERE status = 'preparing' ORDER BY created_at")
    .all()
    .map((row) => String(row.id));
}

/** Keeps the provider's references to the uploaded files, before the graph that uses them is sent. */
export function recordProviderInputs(id: string, inputs: ProviderInputs) {
  database
    .prepare("UPDATE generations SET provider_inputs = ? WHERE id = ? AND status = 'preparing'")
    .run(z.encode(providerInputsColumn, inputs), id);
}

/**
 * Records that the graph is about to be handed to the provider: from now on a crash may leave a
 * job there that the row does not know of (`settleAbandoned` then makes it `unknown`).
 */
export function markSubmitting(id: string) {
  database
    .prepare("UPDATE generations SET submit_started_at = ? WHERE id = ? AND status = 'preparing'")
    .run(new Date().toISOString(), id);
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

/**
 * Comfy completed the job: the row moves to `finalizing` from whichever of `queued`, `running`
 * or `finalizing` it is in now, in one statement, so the event stream's `markRunning` cannot slip
 * in between. `null` when the row is in none of them any more.
 */
export function markFinalizing(id: string) {
  return parseRow(
    database
      .prepare(
        `UPDATE generations SET status = 'finalizing'
        WHERE id = ? AND status IN ('queued', 'running', 'finalizing')
        RETURNING *`,
      )
      .get(id),
  );
}

type Outcome = Partial<Pick<Generation, "error_code" | "error_message">> & {
  /** The stored asset of each output, by its declared name (`OutputDeclaration`). */
  outputs?: Readonly<Record<string, string>>;
};

/** A new share slug: 16 random hex characters, 64 bits nobody can guess. */
function newShareSlug() {
  return randomBytes(8).toString("hex");
}

/**
 * Moves a row from `from` to `to` if the state machine allows it and the row is still in `from`,
 * storing the error or the named outputs that come with the new status (`generation_outputs`).
 * A row that becomes `done` with a file output gets its `share_slug` (`/r/<slug>`, `newShareSlug`)
 * unless its workflow publishes only on request (`publish: "on-request"`: `publishGeneration`
 * gives it one later). The outputs `video` and `poster` are also kept in `final_asset_id` and
 * `poster_asset_id`, the columns that held them before outputs had names, for their readers. A
 * row goes back in line only through `releaseClaim`, which checks it was never submitted.
 */
export function transition(
  id: string,
  from: GenerationStatus,
  to: GenerationStatus,
  outcome: Outcome = {},
) {
  if (!nextStatuses[from].includes(to) || to === "waiting") {
    throw new Error(`A generation cannot go from ${from} to ${to}`);
  }

  const finishedAt = ["done", "failed", "cancelled"].includes(to) ? new Date().toISOString() : null;

  const outputs = Object.entries(outcome.outputs ?? {});

  // A share page shows a file: a generation whose outputs are all text gets none, and one whose
  // workflow publishes on request gets it only then (a workflow no feature registers publishes
  // on done, the default).
  const onlyText =
    outputs.length > 0 && outputs.every(([, assetId]) => findAsset(assetId)?.kind === "text");

  const stored = to === "done" && !onlyText ? findGeneration(id) : null;

  const shareSlug =
    stored && workflows.find(stored)?.publish !== "on-request" ? newShareSlug() : null;

  const row = transaction(database, () => {
    const updated = parseRow(
      database
        .prepare(
          `UPDATE generations SET status = ?, finished_at = coalesce(?, finished_at),
            progress = CASE WHEN ? = 'done' THEN 100 ELSE progress END,
            error_code = coalesce(?, error_code), error_message = coalesce(?, error_message),
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
          outcome.outputs?.video ?? null,
          outcome.outputs?.poster ?? null,
          shareSlug,
          id,
          from,
        ),
    );

    if (updated) {
      const store = database.prepare(
        `INSERT INTO generation_outputs (generation_id, name, asset_id) VALUES (?, ?, ?)
        ON CONFLICT (generation_id, name) DO UPDATE SET asset_id = excluded.asset_id`,
      );

      for (const [name, assetId] of outputs) {
        store.run(id, name, assetId);
      }
    }

    return updated;
  });

  if (!row) {
    throw new Error(`Generation ${id} is not ${from}`);
  }

  queueChanged();

  return row;
}

/** For a row left `preparing` by a crash after `submit()` may have reached the provider. */
export function markUnknown(id: string, outcome: Outcome = {}) {
  return transition(id, "preparing", "unknown", outcome);
}

/**
 * Takes a `waiting` row out of line for good (`waiting → cancelled`): nothing was sent, so its
 * access code gets its count back (`access_codes_return_cancelled`). `null` when it is not
 * waiting (any more).
 */
export function cancelWaiting(id: string, outcome: Outcome = {}) {
  return findGeneration(id)?.status === "waiting"
    ? transition(id, "waiting", "cancelled", {
        error_message: "Cancelled before it was sent to Comfy: nothing was rendered or charged.",
        ...outcome,
      })
    : null;
}

/** Records a finalize that failed (a download or FFmpeg error) and when; returns the row. */
export function countFinalizeAttempt(id: string) {
  const row = parseRow(
    database
      .prepare(
        `UPDATE generations SET finalize_attempts = finalize_attempts + 1, finalize_attempted_at = ?
        WHERE id = ?
        RETURNING *`,
      )
      .get(new Date().toISOString(), id),
  );

  if (!row) {
    throw new Error(`Generation ${id} does not exist`);
  }

  return row;
}

/**
 * Adds named outputs to a `done` generation, leaving any name it already has as it is: what a
 * workflow derives later for a row finished before it did (`deriveForDone`). Returns the names it
 * added; none for a row that is not done.
 */
export function addOutputs(id: string, outputs: Readonly<Record<string, string>>) {
  const store = database.prepare(
    `INSERT INTO generation_outputs (generation_id, name, asset_id)
    SELECT id, ?, ? FROM generations WHERE id = ? AND status = 'done'
    ON CONFLICT (generation_id, name) DO NOTHING`,
  );

  return transaction(database, () =>
    Object.entries(outputs).flatMap(([name, assetId]) =>
      store.run(name, assetId, id).changes > 0 ? [name] : [],
    ),
  );
}

const storedOutputSchema = z.object({ asset_id: z.string(), name: z.string() });

/**
 * Where an output name sorts: by the name it was declared under, then by its file's place, so a
 * declared output's further files (`image-2`, …, `image-10`; `outputFileName`) follow it in
 * Comfy's order. A name with no `-<digits>` ending sorts as itself, as SQLite's `ORDER BY name`.
 */
function outputOrder(name: string) {
  const further = /^(.+)-(\d+)$/.exec(name);

  return further?.[1] && further[2]
    ? { base: further[1], place: Number(further[2]) }
    : { base: name, place: 1 };
}

function byOutputOrder(a: { name: string }, b: { name: string }) {
  const left = outputOrder(a.name);
  const right = outputOrder(b.name);

  if (left.base !== right.base) {
    return left.base < right.base ? -1 : 1;
  }

  return left.place - right.place;
}

/**
 * A generation's named outputs whose assets are stored, by name, with their stored asset; an
 * output's further files right after it, in their order (`byOutputOrder`).
 */
function storedOutputs(generationId: string) {
  return database
    .prepare("SELECT name, asset_id FROM generation_outputs WHERE generation_id = ? ORDER BY name")
    .all(generationId)
    .map((row) => storedOutputSchema.parse(row))
    .sort(byOutputOrder)
    .flatMap(({ asset_id, name }) => {
      const stored = findAsset(asset_id);

      return stored ? [{ name, stored }] : [];
    });
}

/** A stored output as the API shows it: a file with its asset, a text inline. */
function apiOutput(name: string, stored: StoredAsset): GenerationSnapshotOutput {
  const { kind } = stored;

  return kind === "text"
    ? { media: kind, name, text: readFileSync(resolve(assetsDirectory(), stored.path), "utf8") }
    : { asset: assetSchema.parse(stored), media: kind, name };
}

/**
 * A generation's named file outputs whose assets are stored, by name, each with its asset as the
 * API shows it and its media (the asset's kind): what result and share pages show and a character
 * is saved from. Text outputs are left out (`snapshot` shows them).
 */
export function readOutputs(generationId: string): GenerationOutput[] {
  return storedOutputs(generationId).flatMap(({ name, stored }) => {
    const { kind } = stored;

    return kind === "text" ? [] : [{ asset: assetSchema.parse(stored), media: kind, name }];
  });
}

/**
 * Whether a done generation with a share page (`share_slug`) lists this asset among its outputs:
 * such files are public, like the page. A text output never is. One indexed lookup
 * (`generation_outputs_asset`), as it runs for every public media request.
 */
export function isSharedOutput(asset: StoredAsset) {
  return (
    asset.kind !== "text" &&
    database
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM generation_outputs
          JOIN generations ON generations.id = generation_outputs.generation_id
          WHERE generation_outputs.asset_id = ? AND generations.status = 'done'
            AND generations.share_slug IS NOT NULL) AS shared`,
      )
      .get(asset.id)?.shared === 1
  );
}

/**
 * The name a generation lists this asset under among its outputs (the first by name if several
 * do), or `null` when none does: what a file the server composed downloads as
 * (`serveMedia`). One indexed lookup (`generation_outputs_asset`).
 */
export function outputNameOf(assetId: string) {
  const row = database
    .prepare("SELECT name FROM generation_outputs WHERE asset_id = ? ORDER BY name LIMIT 1")
    .get(assetId);

  return row ? z.object({ name: z.string() }).parse(row).name : null;
}

/**
 * Publishes a done generation of a workflow that publishes on request (`publish: "on-request"`),
 * as its owner's choice after seeing it: gives it its share page (`/r/<share_slug>`), which makes
 * its file outputs public (`isSharedOutput`), in one write; its slug. Idempotent: a generation
 * that has a share page keeps it, and that slug is returned (two publishes at once give one).
 * Refused with a `GenerateError`: 404 `not_found`; 409 `not_done`; 409 `no_file` when every
 * output is a text (nothing a share page could show); 409 `not_publishable` when its workflow
 * publishes on done (or no feature registers it).
 */
export function publishGeneration(id: string) {
  const row = findGeneration(id);

  if (!row) {
    throw new GenerateError(404, "Generation not found.", "not_found");
  }

  if (row.share_slug) {
    return row.share_slug;
  }

  if (row.status !== "done") {
    throw new GenerateError(
      409,
      `Only a finished generation can be published; this one is ${row.status}.`,
      "not_done",
    );
  }

  if (readOutputs(id).length === 0) {
    throw new GenerateError(409, "This generation has no image or video to publish.", "no_file");
  }

  if (workflows.find(row)?.publish !== "on-request") {
    throw new GenerateError(
      409,
      "This generation's workflow publishes its results itself; it has no share page to add.",
      "not_publishable",
    );
  }

  const published = database
    .prepare(
      `UPDATE generations SET share_slug = coalesce(share_slug, ?)
      WHERE id = ? AND status = 'done'
      RETURNING share_slug`,
    )
    .get(newShareSlug(), id);

  return z.string().parse(published?.share_slug);
}
