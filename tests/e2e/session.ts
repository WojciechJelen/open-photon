import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Page } from "@playwright/test";

/** The browser state `sign-in.setup.ts` saves once per run: the access session, if any. */
export function storageStatePath() {
  return join(dirname(process.env.E2E_DATABASE_PATH ?? ""), "storage-state.json");
}

/** Opens `path` and waits until React has hydrated it (`__root.tsx`), so clicks take effect. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator("html[data-hydrated]").waitFor();
}

/** The provider job id `seed.ts` stores on its `done` generation; no provider ever saw it. */
export const SEEDED_JOB_ID = "e2e-seeded-job";

/** Runs `read` on the e2e server's database (`playwright.config.ts`), opened read-only. */
function query<T>(read: (database: DatabaseSync) => T) {
  const database = new DatabaseSync(process.env.E2E_DATABASE_PATH ?? "", { readOnly: true });

  try {
    return read(database);
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

/** The `done` generation `seed.ts` adds: its id, its character and the motion clip it was made from. */
export function seededResult() {
  const row = query((database) =>
    database
      .prepare(
        `SELECT generations.id, generations.character_id, assets.id AS source_asset_id
        FROM generations
        JOIN assets ON assets.sha256 = generations.recipe ->> '$.inputs.driving_video_sha256'
        WHERE generations.provider_job_id = ?`,
      )
      .get(SEEDED_JOB_ID),
  );

  return {
    characterId: String(row?.character_id),
    id: String(row?.id),
    sourceAssetId: String(row?.source_asset_id),
  };
}
