import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, type Page } from "@playwright/test";

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

/**
 * Asserts the main navigation marks `category` current (`data-current` on its trigger) and not
 * the other of Image and Video.
 */
export async function expectCurrentCategory(page: Page, category: "Image" | "Video") {
  const navigation = page.getByRole("navigation", { name: "Main" });

  for (const label of ["Image", "Video"]) {
    const trigger = navigation.getByRole("button", { exact: true, name: label });

    await (label === category
      ? expect(trigger).toHaveAttribute("data-current")
      : expect(trigger).not.toHaveAttribute("data-current"));
  }
}

/** The provider job id `seed.ts` stores on its `done` generation; no provider ever saw it. */
export const SEEDED_JOB_ID = "e2e-seeded-job";

/** The provider job id of the `queued` generation `seed.ts` adds; no provider ever saw it. */
export const QUEUED_JOB_ID = "e2e-queued-job";

/**
 * Runs `use` on an e2e server's database (`playwright.config.ts`), read-only unless `write`: the
 * dead-port server's by default, the fake provider's with `E2E_FAKE_DATABASE_PATH`.
 */
function query<T>(
  use: (database: DatabaseSync) => T,
  write = false,
  databasePath = process.env.E2E_DATABASE_PATH ?? "",
) {
  const database = new DatabaseSync(databasePath, { readOnly: !write });

  try {
    return use(database);
  } finally {
    database.close();
  }
}

/** Counts rows in an e2e server's database (the dead-port server's by default). */
export function count(sql: string, databasePath?: string) {
  return query(
    (database) => Number(database.prepare(`SELECT count(*) AS count FROM ${sql}`).get()?.count),
    false,
    databasePath,
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
function removeGeneration(id: string, databasePath?: string) {
  query(
    (database) => {
      database.prepare("DELETE FROM generation_outputs WHERE generation_id = ?").run(id);
      database.prepare("DELETE FROM generations WHERE id = ?").run(id);
    },
    true,
    databasePath,
  );
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
 * Adds a done generation with a share page of a workflow other than Motion Transfer that no
 * feature registers (`test-outputs`), whose outputs are `outputs` (name → asset id), as finalize
 * and publishing store one. Returns its id, its share slug and a function that removes it.
 */
export function addOutputsGeneration(outputs: Record<string, string>) {
  const id = randomUUID();
  const shareSlug = randomUUID().replaceAll("-", "").slice(0, 16);
  const now = new Date().toISOString();

  query((database) => {
    database
      .prepare(
        `INSERT INTO generations (id, workflow_id, workflow_version, recipe, recipe_hash,
          idempotency_key, provider_job_id, target, status, progress, share_slug, created_at,
          submitted_at, finished_at)
        VALUES (?, 'test-outputs', 1, '{}', ?, ?, ?, 'cloud', 'done', 100, ?, ?, ?, ?)`,
      )
      .run(
        id,
        createHash("sha256").update(id).digest("hex"),
        randomUUID(),
        `e2e-outputs-${id}`,
        shareSlug,
        now,
        now,
        now,
      );

    for (const [name, assetId] of Object.entries(outputs)) {
      database
        .prepare("INSERT INTO generation_outputs (generation_id, name, asset_id) VALUES (?, ?, ?)")
        .run(id, name, assetId);
    }
  }, true);

  return { id, remove: () => removeGeneration(id), shareSlug };
}

/**
 * The seeded result's video and poster asset ids, and the image asset ids of the sample
 * characters (by title).
 */
export function seededFiles() {
  return query((database) => {
    const seeded = database
      .prepare("SELECT final_asset_id, poster_asset_id FROM generations WHERE provider_job_id = ?")
      .get(SEEDED_JOB_ID);

    const images = database
      .prepare("SELECT image_asset_id FROM characters WHERE is_sample = 1 ORDER BY title")
      .all()
      .map((row) => String(row.image_asset_id));

    return {
      images,
      poster: String(seeded?.poster_asset_id),
      video: String(seeded?.final_asset_id),
    };
  });
}

/**
 * Adds a poster asset of its own (the seeded poster's JPEG with one more byte, so another
 * SHA-256) for a test that tells two posters apart. Returns its id and a function that removes it.
 */
export function addPosterCopy() {
  const id = randomUUID();
  const directory = join(dirname(process.env.E2E_DATABASE_PATH ?? ""), "assets");
  const { poster } = seededFiles();

  const path = query((database) =>
    String(database.prepare("SELECT path FROM assets WHERE id = ?").get(poster)?.path),
  );

  const bytes = Buffer.concat([readFileSync(join(directory, path)), Buffer.from([0])]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = join(directory, `${sha256}.jpg`);

  writeFileSync(file, bytes);
  query((database) => {
    database
      .prepare(
        `INSERT INTO assets (id, sha256, kind, role, source_asset_id, path, mime, bytes, width,
          height, created_at)
        SELECT ?, ?, kind, role, source_asset_id, ?, mime, ?, width, height, created_at
        FROM assets WHERE id = ?`,
      )
      .run(id, sha256, `${sha256}.jpg`, bytes.length, poster);
  }, true);

  return {
    id,
    remove: () => {
      query((database) => database.prepare("DELETE FROM assets WHERE id = ?").run(id), true);
      rmSync(file, { force: true });
    },
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
 * Adds, for each sample character (by title), a done pre-rendered take with the seeded result and
 * poster, as `scripts/prerender-samples.mjs` leaves one after finalize: its outputs, a share slug
 * and `is_prerendered = 1`, in the database at `databasePath` (the dead-port server's by
 * default). Returns them (title, id, share slug) and a function that removes them.
 */
export function addPrerenderedTakes(databasePath?: string) {
  const takes = query(
    (database) =>
      database
        .prepare(
          `SELECT characters.id AS character_id, characters.title, assets.sha256
          FROM characters JOIN assets ON assets.id = characters.image_asset_id
          WHERE characters.is_sample = 1 ORDER BY characters.title`,
        )
        .all()
        .map((row) => ({
          characterId: String(row.character_id),
          id: randomUUID(),
          imageSha256: String(row.sha256),
          shareSlug: randomUUID().replaceAll("-", "").slice(0, 16),
          title: String(row.title),
        })),
    false,
    databasePath,
  );

  query(
    (database) => {
      for (const take of takes) {
        database
          .prepare(
            `INSERT INTO generations (id, character_id, workflow_id, workflow_version, recipe,
              recipe_hash, idempotency_key, provider_job_id, target, target_origin, status,
              progress, final_asset_id, poster_asset_id, share_slug, is_prerendered, created_at,
              submitted_at, finished_at)
            SELECT ?, ?, workflow_id, workflow_version,
              json_set(recipe, '$.inputs.reference_image_sha256', ?), ?, ?, ?, target,
              target_origin, 'done', 100, final_asset_id, poster_asset_id, ?, 1, created_at,
              submitted_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            FROM generations WHERE provider_job_id = ?`,
          )
          .run(
            take.id,
            take.characterId,
            take.imageSha256,
            createHash("sha256").update(take.id).digest("hex"),
            randomUUID(),
            `e2e-prerendered-${take.id}`,
            take.shareSlug,
            SEEDED_JOB_ID,
          );
        database
          .prepare(
            `INSERT INTO generation_outputs (generation_id, name, asset_id)
            SELECT ?, name, asset_id FROM generation_outputs
            WHERE generation_id = (SELECT id FROM generations WHERE provider_job_id = ?)`,
          )
          .run(take.id, SEEDED_JOB_ID);
      }
    },
    true,
    databasePath,
  );

  return {
    remove: () => {
      for (const { id } of takes) {
        removeGeneration(id, databasePath);
      }
    },
    takes,
  };
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

/** A seeded sample character (`arthur`): its id and its image's asset id. */
export function sampleCharacter() {
  const row = query((database) =>
    database.prepare("SELECT id, image_asset_id FROM characters WHERE slug = 'arthur'").get(),
  );

  return { id: String(row?.id), imageAssetId: String(row?.image_asset_id) };
}
