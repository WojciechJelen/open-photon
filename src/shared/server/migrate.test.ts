import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { migrate } from "./migrate.ts";

const MIGRATIONS = resolve("src/shared/server/migrations");
const legacyFiles = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql"));

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** A directory with a copy of the real legacy migrations, removed after the test. */
function migrationsCopy(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "open-photon-migrations-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  for (const file of legacyFiles) {
    cpSync(join(MIGRATIONS, file), join(directory, file));
  }

  return directory;
}

/** What the flat-only runner (before namespaces) did to a database: the legacy files, in order. */
function migrateAsBefore(database: DatabaseSync, directory: string) {
  database.exec(`CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`);

  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec("BEGIN IMMEDIATE");
    database.exec(readFileSync(join(directory, file), "utf8"));
    database
      .prepare("INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(Number(file.slice(0, 3)), file, "2026-10-01T00:00:00.000Z");
    database.exec("COMMIT");
  }
}

const rows = (database: DatabaseSync) =>
  database
    .prepare(
      "SELECT version, name, applied_at, identity, checksum FROM migrations ORDER BY version",
    )
    .all()
    .map((row) => ({ ...row }));

test("a database the flat-only runner migrated upgrades in place; a namespaced migration applies once and stays immutable", (t) => {
  const directory = migrationsCopy(t);
  const database = new DatabaseSync(":memory:");

  migrateAsBefore(database, directory);

  const before = database
    .prepare("SELECT version, name, applied_at FROM migrations ORDER BY version")
    .all()
    .map((row) => ({ ...row }));

  mkdirSync(join(directory, "example"));
  writeFileSync(join(directory, "example", "001-x.sql"), "CREATE TABLE example_x (id INTEGER);\n");

  migrate(database, directory);

  const after = rows(database);

  // The legacy rows keep their version, name and time, and gain an identity and their checksum.
  assert.deepEqual(
    after.slice(0, legacyFiles.length),
    before.map((row, index) => ({
      ...row,
      checksum: sha256(join(directory, legacyFiles[index] ?? "")),
      identity: `legacy/${String(row.version).padStart(3, "0")}`,
    })),
  );

  const example = after.at(-1);

  assert.equal(after.length, legacyFiles.length + 1);
  assert.equal(example?.identity, "example/001");
  assert.equal(example?.name, "example/001-x.sql");
  assert.equal(example?.checksum, sha256(join(directory, "example", "001-x.sql")));
  assert.ok(database.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'example_x'").get());

  // Running again changes nothing.
  migrate(database, directory);
  assert.deepEqual(rows(database), after);

  // An applied migration whose bytes changed stops the start, and nothing is recorded.
  writeFileSync(join(directory, "example", "001-x.sql"), "CREATE TABLE example_y (id INTEGER);\n");
  assert.throws(() => migrate(database, directory), {
    message: /^Migration example\/001 \(example\/001-x\.sql\) changed after it was applied/,
  });
  assert.deepEqual(rows(database), after);

  // So does a legacy file, now that its checksum is recorded.
  writeFileSync(join(directory, "example", "001-x.sql"), "CREATE TABLE example_x (id INTEGER);\n");
  writeFileSync(join(directory, legacyFiles[0] ?? ""), "-- edited\n", { flag: "a" });
  assert.throws(() => migrate(database, directory), {
    message: /^Migration legacy\/001 \(001-assets-generations\.sql\) changed after it was applied/,
  });
});

test("a fresh database gets the legacy migrations as legacy/001…, then shared, then other domains alphabetically", (t) => {
  const directory = migrationsCopy(t);
  const database = new DatabaseSync(":memory:");

  for (const [domain, file] of [
    ["zeta", "001-z.sql"],
    ["alpha", "002-b.sql"],
    ["alpha", "001-a.sql"],
    ["shared", "001-s.sql"],
  ] as const) {
    mkdirSync(join(directory, domain), { recursive: true });
    writeFileSync(join(directory, domain, file), `SELECT 1;\n`);
  }

  migrate(database, directory);

  assert.deepEqual(
    rows(database).map(({ identity }) => identity),
    [
      ...legacyFiles.map((file) => `legacy/${file.slice(0, 3)}`),
      "shared/001",
      "alpha/001",
      "alpha/002",
      "zeta/001",
    ],
  );
});

test("badly named or placed migrations are refused before anything applies", (t) => {
  const cases: [string, string, RegExp][] = [
    ["example/1-x.sql", "SELECT 1;", /example\/1-x\.sql is not named NNN-name\.sql/],
    ["008-new.sql", "SELECT 1;", /flat files stop at 007\. Add it as <domain>\/008-new\.sql/],
    ["legacy/008-new.sql", "SELECT 1;", /legacy\/ is not a domain name/],
    ["Example/001-x.sql", "SELECT 1;", /Example\/ is not a domain name/],
  ];

  for (const [path, sql, message] of cases) {
    const directory = migrationsCopy(t);
    const database = new DatabaseSync(":memory:");

    mkdirSync(join(directory, path, ".."), { recursive: true });
    writeFileSync(join(directory, path), sql);

    assert.throws(() => migrate(database, directory), { message });
    assert.equal(
      database.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'generations'").get(),
      undefined,
    );
  }
});
