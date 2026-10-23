import { randomBytes, randomUUID } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";

import { z } from "zod";

import {
  assetSchema,
  type GenerationOutput,
  generationSchema,
  type generationStatusSchema,
} from "../../contracts.ts";
import { findAsset, type StoredAsset } from "../assets.ts";
import { assetReferenceSchema } from "../comfy-assets.ts";
import type { ProviderTarget } from "../comfy-target.ts";
import { database } from "../db.server.ts";
import { transaction } from "../migrate.ts";
import {
  recipeIdentitySchema,
  type WorkflowDefinition,
  type WorkflowRecipe,
} from "./definition.ts";
import { recipeHash } from "./recipe-hash.ts";

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

// The recipe as stored: a JSON object only its workflow's definition decodes (`recipeSchema`).
const recipeColumn = jsonColumn(z.record(z.string(), z.json()));

// The `asReference()` values of the files uploaded to the provider, by the names the workflow's
// `assetInputs` gives them, to rebuild the graph.
const providerInputsColumn = jsonColumn(z.record(z.string(), assetReferenceSchema));

type ProviderInputs = z.output<typeof providerInputsColumn>;

const generationRowSchema = generationSchema.extend({
  access_code_id: z.string().nullable(),
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
 * Inserts a `preparing` row whose idempotency key exists before anything reaches the provider,
 * for `definition`'s workflow and the recipe it decodes (`hashRecipe`), on `target`, with the
 * access code that asked for it (which counts it, `006-access-codes.sql`) and the rows it links
 * to (`characterId`, the sample `motionId`). The row comes back with that recipe.
 */
export function createGeneration<Input, Recipe extends WorkflowRecipe>(
  definition: WorkflowDefinition<Input, Recipe>,
  {
    accessCodeId,
    characterId,
    motionId,
    parentId,
    recipe,
    target,
  }: {
    accessCodeId?: string;
    characterId?: string;
    motionId?: string;
    parentId?: string;
    recipe: Recipe;
    target: ProviderTarget;
  },
): DecodedGeneration<Recipe> {
  const { hash, recipe: parsed } = hashRecipe(definition, recipe);

  const row = database
    .prepare(
      `INSERT INTO generations (id, parent_id, motion_id, character_id, workflow_id,
        workflow_version, recipe, recipe_hash, idempotency_key, target, target_origin, status,
        access_code_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?)
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
      accessCodeId ?? null,
      new Date().toISOString(),
    );

  return { ...generationRowSchema.parse(row), recipe: parsed };
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
 * A generation of `workflow` with this recipe that may still produce its output: on its way, or
 * `unknown` (Comfy may be rendering it) for up to a day. Submitting the recipe again would pay
 * for a second job; an `unknown` row older than that is left alone, so the recipe can be
 * generated again.
 */
export function findPending(hash: string, workflow: WorkflowKey) {
  return parseRow(
    database
      .prepare(
        `SELECT * FROM generations WHERE recipe_hash = ? AND workflow_id = ? AND workflow_version = ?
          AND (status IN ('preparing', 'queued', 'running', 'finalizing')
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

/**
 * Moves a row from `from` to `to` if the state machine allows it and the row is still in `from`,
 * storing the error or the named outputs that come with the new status (`generation_outputs`).
 * A row that becomes `done` gets its `share_slug` (`/r/<slug>`): 16 random hex characters, 64
 * bits nobody can guess. The outputs `video` and `poster` are also kept in `final_asset_id` and
 * `poster_asset_id`, the columns that held them before outputs had names, for their readers.
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
  const outputs = Object.entries(outcome.outputs ?? {});

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

  return row;
}

/** For a row left `preparing` by a crash after `submit()` may have reached the provider. */
export function markUnknown(id: string, outcome: Outcome = {}) {
  return transition(id, "preparing", "unknown", outcome);
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

const storedOutputSchema = z.object({ asset_id: z.string(), name: z.string() });

/**
 * A generation's named outputs whose assets are stored, by name, each with its asset as the API
 * shows it and its media (the asset's kind).
 */
export function readOutputs(generationId: string): GenerationOutput[] {
  return database
    .prepare("SELECT name, asset_id FROM generation_outputs WHERE generation_id = ? ORDER BY name")
    .all(generationId)
    .flatMap((row) => {
      const { asset_id, name } = storedOutputSchema.parse(row);
      const stored = findAsset(asset_id);
      const asset = stored ? assetSchema.parse(stored) : null;

      return asset ? [{ asset, media: asset.kind, name }] : [];
    });
}

/**
 * Whether a done generation with a share page (`share_slug`) lists this asset among its outputs:
 * such files are public, like the page. One indexed lookup (`generation_outputs_asset`), as it
 * runs for every public media request.
 */
export function isSharedOutput(asset: StoredAsset) {
  return (
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
