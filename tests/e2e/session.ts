import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Page } from "@playwright/test";

/** The browser state `sign-in.setup.ts` saves once per run: the access session. */
export function storageStatePath() {
  return join(dirname(process.env.E2E_DATABASE_PATH ?? ""), "storage-state.json");
}

/** Where `seed.ts` keeps the access code it mints for the run: next to the database. */
export function accessCodePath(databasePath = process.env.E2E_DATABASE_PATH ?? "") {
  return join(dirname(databasePath), "access-code");
}

/** The run's access code (`seed.ts`). */
export function accessCode() {
  return readFileSync(accessCodePath(), "utf8");
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
 * Adds a `queued` generation like the seeded one (its own id, key and job id), so both places
 * the e2e server allows in flight (`IN_FLIGHT_MAX` in `playwright.config.ts`) are taken; the
 * returned function removes it. Comfy at the dead port never moves either on.
 */
export function takeLastInFlightPlace() {
  const id = randomUUID();

  query(
    (database) =>
      database
        .prepare(
          `INSERT INTO generations (id, kind, character_id, workflow_id, workflow_version, recipe,
            recipe_hash, idempotency_key, provider_job_id, target, status, created_at)
          SELECT ?, kind, character_id, workflow_id, workflow_version, recipe, recipe_hash, ?, ?,
            target, 'queued', created_at
          FROM generations WHERE provider_job_id = ?`,
        )
        .run(id, randomUUID(), `e2e-in-flight-${id}`, QUEUED_JOB_ID),
    true,
  );

  return () =>
    query((database) => database.prepare("DELETE FROM generations WHERE id = ?").run(id), true);
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
