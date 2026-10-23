import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Page } from "@playwright/test";

/**
 * The browser state `sign-in.setup.ts` saves once per run and server: the access session of the
 * server whose database is `databasePath` (the dead-port one by default).
 */
export function storageStatePath(databasePath = process.env.E2E_DATABASE_PATH ?? "") {
  return join(dirname(databasePath), "storage-state.json");
}

/** Where `seed.ts` keeps the access code it mints for the run: next to the database. */
export function accessCodePath(databasePath = process.env.E2E_DATABASE_PATH ?? "") {
  return join(dirname(databasePath), "access-code");
}

/** The run's access code (`seed.ts`) on the server whose database is `databasePath`. */
export function accessCode(databasePath = process.env.E2E_DATABASE_PATH ?? "") {
  return readFileSync(accessCodePath(databasePath), "utf8");
}

/** Opens `path` and waits until React has hydrated it (`__root.tsx`), so clicks take effect. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator("html[data-hydrated]").waitFor();
}

/** The provider job id `seed.ts` stores on its `done` generation; no provider ever saw it. */
export const SEEDED_JOB_ID = "e2e-seeded-job";

/** The provider job id of the `queued` generation `seed.ts` adds; no provider ever saw it. */
export const QUEUED_JOB_ID = "e2e-queued-job";

/** Runs `use` on the e2e server's database (`playwright.config.ts`), read-only unless `write`. */
function query<T>(use: (database: DatabaseSync) => T, write = false) {
  const database = new DatabaseSync(process.env.E2E_DATABASE_PATH ?? "", { readOnly: !write });

  try {
    return use(database);
  } finally {
    database.close();
  }
}

/** Counts rows in the e2e server's database. */
export function count(sql: string) {
  return query((database) =>
    Number(database.prepare(`SELECT count(*) AS count FROM ${sql}`).get()?.count),
  );
}

/** The id of the `queued` generation `seed.ts` adds. */
export function queuedGenerationId() {
  return query((database) =>
    String(
      database.prepare("SELECT id FROM generations WHERE provider_job_id = ?").get(QUEUED_JOB_ID)
        ?.id,
    ),
  );
}

/**
 * Adds a `queued` generation like the seeded one (its own id, key and job id); Comfy at the dead
 * port never moves it on. Returns its id and a function that removes it.
 */
export function addQueuedGeneration() {
  const id = randomUUID();

  query(
    (database) =>
      database
        .prepare(
          `INSERT INTO generations (id, character_id, workflow_id, workflow_version, recipe,
            recipe_hash, idempotency_key, provider_job_id, target, target_origin, status,
            created_at)
          SELECT ?, character_id, workflow_id, workflow_version, recipe, recipe_hash, ?, ?,
            target, target_origin, 'queued', created_at
          FROM generations WHERE provider_job_id = ?`,
        )
        .run(id, randomUUID(), `e2e-in-flight-${id}`, QUEUED_JOB_ID),
    true,
  );

  return { id, remove: () => removeGeneration(id) };
}

/** Deletes the generation `id` and its outputs' rows (a test's own, never a seeded one). */
function removeGeneration(id: string) {
  query((database) => {
    database.prepare("DELETE FROM generation_outputs WHERE generation_id = ?").run(id);
    database.prepare("DELETE FROM generations WHERE id = ?").run(id);
  }, true);
}

/**
 * Adds a done generation of a workflow other than Motion Transfer whose one output is a text (a
 * caption), as finalize stores one: a private `text` asset, its `.txt` file in the server's
 * assets directory. Returns its id, its text and a function that removes it.
 */
export function addTextOnlyGeneration() {
  const id = randomUUID();
  const assetId = randomUUID();
  const text = `A full-body caption ${id}.`;
  const sha256 = createHash("sha256").update(text).digest("hex");
  const directory = join(dirname(process.env.E2E_DATABASE_PATH ?? ""), "assets");
  const file = join(directory, `${sha256}.txt`);
  const now = new Date().toISOString();

  mkdirSync(directory, { recursive: true });
  writeFileSync(file, text);

  query((database) => {
    database
      .prepare(
        `INSERT INTO assets (id, sha256, kind, role, path, mime, bytes, created_at)
        VALUES (?, ?, 'text', 'provider_output', ?, 'text/plain; charset=utf-8', ?, ?)`,
      )
      .run(assetId, sha256, `${sha256}.txt`, Buffer.byteLength(text), now);
    database
      .prepare(
        `INSERT INTO generations (id, workflow_id, workflow_version, recipe, recipe_hash,
          idempotency_key, provider_job_id, target, status, progress, created_at, submitted_at,
          finished_at)
        VALUES (?, 'test-caption', 1, '{}', ?, ?, ?, 'cloud', 'done', 100, ?, ?, ?)`,
      )
      .run(id, "0".repeat(64), randomUUID(), `e2e-text-${id}`, now, now, now);
    database
      .prepare(
        "INSERT INTO generation_outputs (generation_id, name, asset_id) VALUES (?, 'caption', ?)",
      )
      .run(id, assetId);
  }, true);

  return {
    id,
    remove: () => {
      removeGeneration(id);
      query((database) => database.prepare("DELETE FROM assets WHERE id = ?").run(assetId), true);
      rmSync(file, { force: true });
    },
    text,
  };
}

/**
 * Takes the second place the e2e server allows in flight (`IN_FLIGHT_MAX` in
 * `playwright.config.ts`) with `addQueuedGeneration`, so both are taken; the returned function
 * gives it back.
 */
export function takeLastInFlightPlace() {
  return addQueuedGeneration().remove;
}

/**
 * Cancels the `waiting` generation `id` (a no-op for any other), as the service does: the access
 * code's count comes back by the database's trigger.
 */
export function cancelWaiting(id: string) {
  query(
    (database) =>
      database
        .prepare(
          "UPDATE generations SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'waiting'",
        )
        .run(new Date().toISOString(), id),
    true,
  );
}

/**
 * Stores `id` as done with the seeded result and poster (its outputs `video` and `poster`, and
 * the columns that mirror them), as `finalize` would once Comfy finished it; the page sees it on
 * its next read.
 */
export function finishGeneration(id: string) {
  query((database) => {
    database
      .prepare(
        `UPDATE generations SET status = 'done', progress = 100,
          finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          share_slug = lower(hex(randomblob(8))),
          final_asset_id = (SELECT final_asset_id FROM generations WHERE provider_job_id = ?),
          poster_asset_id = (SELECT poster_asset_id FROM generations WHERE provider_job_id = ?)
        WHERE id = ?`,
      )
      .run(SEEDED_JOB_ID, SEEDED_JOB_ID, id);
    database
      .prepare(
        `INSERT INTO generation_outputs (generation_id, name, asset_id)
        SELECT ?, name, asset_id FROM generation_outputs
        WHERE generation_id = (SELECT id FROM generations WHERE provider_job_id = ?)`,
      )
      .run(id, SEEDED_JOB_ID);
  }, true);
}

/**
 * The `done` generation `seed.ts` adds: its id, its character, the motion clip it was made from,
 * its result and its share slug.
 */
export function seededResult() {
  const row = query((database) =>
    database
      .prepare(
        `SELECT generations.id, generations.character_id, generations.final_asset_id,
          generations.share_slug, assets.id AS source_asset_id
        FROM generations
        JOIN assets ON assets.sha256 = generations.recipe ->> '$.inputs.driving_video_sha256'
        WHERE generations.provider_job_id = ?`,
      )
      .get(SEEDED_JOB_ID),
  );

  return {
    characterId: String(row?.character_id),
    finalAssetId: String(row?.final_asset_id),
    id: String(row?.id),
    shareSlug: String(row?.share_slug),
    sourceAssetId: String(row?.source_asset_id),
  };
}

/** A seeded sample character (`placeholder-blue`): its id and its image's asset id. */
export function sampleCharacter() {
  const row = query((database) =>
    database
      .prepare("SELECT id, image_asset_id FROM characters WHERE slug = 'placeholder-blue'")
      .get(),
  );

  return { id: String(row?.id), imageAssetId: String(row?.image_asset_id) };
}
