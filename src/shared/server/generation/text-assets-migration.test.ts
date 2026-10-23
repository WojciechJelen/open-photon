import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { migrate } from "../migrate.ts";

const MIGRATIONS = resolve("src/shared/server/migrations");

test("shared/004 rebuilds assets for text outputs: rows, columns and every link to them survive", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "open-photon-text-assets-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  // Every migration before this one: the legacy files, then each domain without shared/004.
  for (const entry of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (entry.isFile()) {
      cpSync(join(MIGRATIONS, entry.name), join(directory, entry.name));
    } else {
      mkdirSync(join(directory, entry.name));

      for (const file of readdirSync(join(MIGRATIONS, entry.name))) {
        if (entry.name !== "shared" || file < "004") {
          cpSync(join(MIGRATIONS, entry.name, file), join(directory, entry.name, file));
        }
      }
    }
  }

  const database = new DatabaseSync(":memory:");

  database.exec("PRAGMA foreign_keys = ON");
  migrate(database, directory);

  // A text asset is refused before the migration.
  const insertAsset = database.prepare(
    `INSERT INTO assets (id, sha256, kind, role, source_asset_id, path, mime, bytes, width, height,
      duration_ms, fps, has_audio, license_ref, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-10-20T00:00:00.000Z')`,
  );

  const text = ["text", "t".repeat(64), "text", "provider_output", null, "t.txt"] as const;

  assert.throws(
    () =>
      insertAsset.run(...text, "text/plain; charset=utf-8", 5, null, null, null, null, null, null),
    /CHECK constraint failed/,
  );

  insertAsset.run(
    "video",
    "v".repeat(64),
    "video",
    "provider_output",
    null,
    "v.mp4",
    "video/mp4",
    9,
    480,
    848,
    5000,
    16,
    1,
    null,
  );
  insertAsset.run(
    "poster",
    "p".repeat(64),
    "poster",
    "poster",
    "video",
    "p.jpg",
    "image/jpeg",
    3,
    480,
    848,
    null,
    null,
    null,
    null,
  );
  insertAsset.run(
    "image",
    "i".repeat(64),
    "image",
    "sample",
    null,
    "i.png",
    "image/png",
    4,
    512,
    832,
    null,
    null,
    null,
    "CC0",
  );

  database
    .prepare(
      `INSERT INTO generations (id, workflow_id, workflow_version, recipe, recipe_hash,
        idempotency_key, provider_job_id, target, status, final_asset_id, poster_asset_id,
        created_at)
      VALUES ('generation', 'motion-transfer', 1, '{}', ?, ?, 'job', 'cloud', 'done', 'video',
        'poster', '2026-10-20T00:00:00.000Z')`,
    )
    .run("0".repeat(64), crypto.randomUUID());

  database
    .prepare(
      `INSERT INTO generation_outputs (generation_id, name, asset_id)
      VALUES ('generation', 'video', 'video'), ('generation', 'poster', 'poster')`,
    )
    .run();

  database
    .prepare(
      `INSERT INTO characters (id, image_asset_id, origin, created_at)
      VALUES ('character', 'image', 'generated', '2026-10-20T00:00:00.000Z')`,
    )
    .run();

  const before = database.prepare("SELECT rowid, * FROM assets ORDER BY rowid").all();

  cpSync(join(MIGRATIONS, "shared"), join(directory, "shared"), { recursive: true });
  migrate(database, directory);

  // Every row and column is there, every link holds, and foreign keys are enforced again.
  assert.deepEqual(database.prepare("SELECT rowid, * FROM assets ORDER BY rowid").all(), before);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  assert.throws(
    () => database.prepare("DELETE FROM assets WHERE id = 'video'").run(),
    /FOREIGN KEY constraint failed/,
  );

  // A text asset is stored now; any other kind is still refused, and a sha256 stays unique.
  insertAsset.run(...text, "text/plain; charset=utf-8", 5, null, null, null, null, null, null);
  assert.throws(
    () =>
      insertAsset.run(
        "other",
        "o".repeat(64),
        "audio",
        "provider_output",
        null,
        "o.mp3",
        "audio/mpeg",
        1,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      insertAsset.run(
        "again",
        "t".repeat(64),
        "text",
        "provider_output",
        null,
        "a.txt",
        "text/plain; charset=utf-8",
        5,
        null,
        null,
        null,
        null,
        null,
        null,
      ),
    /UNIQUE constraint failed/,
  );
  assert.equal(
    database.prepare("SELECT count(*) AS n FROM migrations WHERE identity = 'shared/004'").get()?.n,
    1,
  );
  database.close();
});
