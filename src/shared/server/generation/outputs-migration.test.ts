import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { migrate } from "../migrate.ts";

const MIGRATIONS = resolve("src/shared/server/migrations");

/** An asset row of `kind`, as the app stores one. */
function insertAsset(database: DatabaseSync, kind: "poster" | "video", sha: string) {
  const id = crypto.randomUUID();

  database
    .prepare(
      `INSERT INTO assets (id, sha256, kind, role, path, mime, bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, '2026-10-20T00:00:00.000Z')`,
    )
    .run(
      id,
      sha.repeat(64),
      kind,
      kind === "video" ? "provider_output" : "poster",
      `${sha.repeat(64)}.${kind === "video" ? "mp4" : "jpg"}`,
      kind === "video" ? "video/mp4" : "image/jpeg",
    );

  return id;
}

/** A Motion Transfer row as the app stored it before named outputs. */
function insertGeneration(
  database: DatabaseSync,
  status: "done" | "failed",
  assets: { final: string | null; poster: string | null },
) {
  const id = crypto.randomUUID();

  database
    .prepare(
      `INSERT INTO generations (id, workflow_id, workflow_version, recipe, recipe_hash,
        idempotency_key, provider_job_id, target, status, final_asset_id, poster_asset_id,
        share_slug, created_at)
      VALUES (?, 'motion-transfer', 1, '{}', ?, ?, ?, 'cloud', ?, ?, ?, ?,
        '2026-10-20T00:00:00.000Z')`,
    )
    .run(
      id,
      "0".repeat(64),
      crypto.randomUUID(),
      status === "done" ? `job-${id}` : null,
      status,
      assets.final,
      assets.poster,
      status === "done" ? id.replaceAll("-", "").slice(0, 16) : null,
    );

  return id;
}

test("shared/001 gives every done generation of a legacy database its outputs video and poster", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "open-photon-outputs-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
    cpSync(join(MIGRATIONS, file), join(directory, file));
  }

  const database = new DatabaseSync(":memory:");

  // The legacy migrations only, as a database before named outputs had them.
  migrate(database, directory);

  const withPoster = insertGeneration(database, "done", {
    final: insertAsset(database, "video", "a"),
    poster: insertAsset(database, "poster", "b"),
  });

  const withoutPoster = insertGeneration(database, "done", {
    final: insertAsset(database, "video", "c"),
    poster: null,
  });

  const failed = insertGeneration(database, "failed", { final: null, poster: null });

  cpSync(join(MIGRATIONS, "shared"), join(directory, "shared"), { recursive: true });
  migrate(database, directory);

  const outputs = database
    .prepare(
      `SELECT generation_outputs.generation_id AS id, name,
        asset_id = CASE name WHEN 'video' THEN final_asset_id ELSE poster_asset_id END AS mirrored
      FROM generation_outputs JOIN generations ON generations.id = generation_id
      ORDER BY id, name`,
    )
    .all()
    .map((row) => ({ ...row }));

  assert.deepEqual(
    outputs,
    [
      { id: withPoster, mirrored: 1, name: "poster" },
      { id: withPoster, mirrored: 1, name: "video" },
      { id: withoutPoster, mirrored: 1, name: "video" },
    ].sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? -1 : 1)),
  );
  assert.equal(
    database
      .prepare("SELECT count(*) AS n FROM generation_outputs WHERE generation_id = ?")
      .get(failed)?.n,
    0,
  );

  // Sharing reads the outputs now; the source clip keeps its index.
  const indexes = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%shared%'")
    .all()
    .map(({ name }) => name);

  assert.deepEqual(indexes, ["generations_shared_source"]);

  const columns = database
    .prepare("SELECT name FROM pragma_table_info('generations')")
    .all()
    .map(({ name }) => name);

  assert.ok(columns.includes("target_origin") && columns.includes("submit_started_at"));
  database.close();
});
