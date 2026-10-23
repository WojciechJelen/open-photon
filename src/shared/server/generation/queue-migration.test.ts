import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { migrate } from "../migrate.ts";

const MIGRATIONS = resolve("src/shared/server/migrations");

/** Inserts a generation row as the app stored one before the waiting queue; returns its id. */
function insertGeneration(
  database: DatabaseSync,
  {
    accessCodeId = null,
    parentId = null,
    providerInputs = null,
    status,
  }: {
    accessCodeId?: string | null;
    parentId?: string | null;
    providerInputs?: string | null;
    status: "done" | "preparing" | "queued";
  },
) {
  const id = crypto.randomUUID();

  database
    .prepare(
      `INSERT INTO generations (id, parent_id, workflow_id, workflow_version, recipe, recipe_hash,
        idempotency_key, provider_job_id, provider_inputs, target, status, access_code_id,
        created_at)
      VALUES (?, ?, 'motion-transfer', 1, '{}', ?, ?, ?, ?, 'cloud', ?, ?,
        '2026-10-20T00:00:00.000Z')`,
    )
    .run(
      id,
      parentId,
      "0".repeat(64),
      crypto.randomUUID(),
      status === "preparing" ? null : `job-${id}`,
      providerInputs,
      status,
      accessCodeId,
    );

  return id;
}

test("shared/002 rebuilds generations for the waiting queue: rows, links, indexes and the access-code triggers survive, and cancelling a waiting row refunds", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "open-photon-queue-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  // Every migration before this one: the legacy files, then each domain without shared/002.
  for (const entry of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (entry.isFile()) {
      cpSync(join(MIGRATIONS, entry.name), join(directory, entry.name));
    } else {
      mkdirSync(join(directory, entry.name));

      for (const file of readdirSync(join(MIGRATIONS, entry.name))) {
        if (entry.name !== "shared" || file < "002") {
          cpSync(join(MIGRATIONS, entry.name, file), join(directory, entry.name, file));
        }
      }
    }
  }

  const database = new DatabaseSync(":memory:");

  database.exec("PRAGMA foreign_keys = ON");
  migrate(database, directory);

  database
    .prepare(
      `INSERT INTO access_codes (id, code_hash, label, max_generations, used, created_at)
      VALUES ('code', ?, 'test', 10, 0, '2026-10-20T00:00:00.000Z')`,
    )
    .run("c".repeat(64));

  database
    .prepare(
      `INSERT INTO assets (id, sha256, kind, role, path, mime, bytes, created_at)
      VALUES ('asset', ?, 'image', 'provider_output', 'a.png', 'image/png', 1,
        '2026-10-20T00:00:00.000Z')`,
    )
    .run("a".repeat(64));

  const parent = insertGeneration(database, { accessCodeId: "code", status: "done" });

  const child = insertGeneration(database, {
    accessCodeId: "code",
    parentId: parent,
    status: "queued",
  });

  // Left preparing by the flat-only server after its uploads: the submit may have started.
  const uploaded = insertGeneration(database, {
    accessCodeId: "code",
    providerInputs: "{}",
    status: "preparing",
  });

  database
    .prepare(
      "INSERT INTO generation_outputs (generation_id, name, asset_id) VALUES (?, 'image', 'asset')",
    )
    .run(parent);

  database
    .prepare(
      `INSERT INTO characters (id, image_asset_id, origin, generation_id, created_at)
      VALUES ('character', 'asset', 'generated', ?, '2026-10-20T00:00:00.000Z')`,
    )
    .run(parent);

  const used = () => Number(database.prepare("SELECT used FROM access_codes").get()?.used);

  assert.equal(used(), 3);

  cpSync(join(MIGRATIONS, "shared"), join(directory, "shared"), { recursive: true });
  migrate(database, directory);

  // Every row and every link to it is there, foreign keys hold and are enforced again.
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  assert.equal(
    database.prepare("SELECT parent_id FROM generations WHERE id = ?").get(child)?.parent_id,
    parent,
  );
  assert.equal(database.prepare("SELECT count(*) AS n FROM generations").get()?.n, 3);
  assert.throws(
    () => database.prepare("DELETE FROM generations WHERE id = ?").run(parent),
    /FOREIGN KEY constraint failed/,
  );

  // The flat-only server's uploaded row counts as possibly submitted: it recovers to unknown.
  assert.ok(
    database.prepare("SELECT submit_started_at FROM generations WHERE id = ?").get(uploaded)
      ?.submit_started_at,
  );

  const objects = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE tbl_name = 'generations' AND type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);

  assert.deepEqual(objects, [
    "access_codes_count_generation",
    "access_codes_return_cancelled",
    "access_codes_return_generation",
    "generations_recipe_hash_status",
    "generations_request_key",
    "generations_shared_source",
    "generations_status_created",
  ]);

  // The triggers fire on the new table: a waiting row counts, cancelling it gives the count back,
  // a preparing row that fails gives it back, one that becomes unknown keeps it.
  const insert = database.prepare(
    `INSERT INTO generations (id, workflow_id, workflow_version, recipe, recipe_hash,
      idempotency_key, target, status, access_code_id, created_at, request_key)
    VALUES (?, 'test-image', 1, '{}', ?, ?, 'cloud', ?, 'code', '2026-10-21T00:00:00.000Z', ?)`,
  );

  const waiting = crypto.randomUUID();
  const preparing = crypto.randomUUID();
  const unsure = crypto.randomUUID();

  insert.run(waiting, "0".repeat(64), crypto.randomUUID(), "waiting", "key");
  insert.run(preparing, "0".repeat(64), crypto.randomUUID(), "preparing", null);
  insert.run(unsure, "0".repeat(64), crypto.randomUUID(), "preparing", null);

  assert.equal(used(), 6);

  const move = database.prepare("UPDATE generations SET status = ? WHERE id = ?");

  move.run("cancelled", waiting);
  move.run("failed", preparing);
  move.run("unknown", unsure);

  assert.equal(used(), 4);

  // One row per request key and workflow.
  assert.throws(
    () => insert.run(crypto.randomUUID(), "0".repeat(64), crypto.randomUUID(), "waiting", "key"),
    /UNIQUE constraint failed/,
  );
  database.close();
});
