import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * The flat `NNN-name.sql` files that predate namespaces stop here; they are recorded as
 * `legacy/NNN`. New migrations go in a `<domain>/` subdirectory.
 */
const LEGACY_LAST = 7;

const fileName = /^(\d{3})-[a-z0-9-]+\.sql$/;
const domainName = /^[a-z][a-zA-Z0-9-]*$/;

type Migration = {
  checksum: string;
  /** `<domain>/NNN`, `legacy/NNN` for a flat file: what `migrations.identity` records. */
  identity: string;
  /** What `migrations.name` records: the file name, under its domain unless legacy. */
  name: string;
  namespace: string;
  number: number;
  sql: string;
};

/**
 * Runs `operation` in one `BEGIN IMMEDIATE` transaction of `database`, rolled back if it throws.
 * Called inside a transaction already, it runs in a savepoint of it instead: rolled back alone if
 * it throws, committed with the outer transaction.
 */
export function transaction<T>(database: DatabaseSync, operation: () => T): T {
  if (database.isTransaction) {
    database.exec("SAVEPOINT nested");

    try {
      const result = operation();
      database.exec("RELEASE nested");

      return result;
    } catch (error) {
      database.exec("ROLLBACK TO nested");
      database.exec("RELEASE nested");
      throw error;
    }
  }

  database.exec("BEGIN IMMEDIATE");

  try {
    const result = operation();
    database.exec("COMMIT");

    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function readMigration(directory: string, namespace: string, file: string): Migration {
  const number = fileName.exec(file)?.[1];
  const name = namespace === "legacy" ? file : `${namespace}/${file}`;

  if (!number) {
    throw new Error(`Migration ${name} is not named NNN-name.sql`);
  }

  if (namespace === "legacy" && Number(number) > LEGACY_LAST) {
    throw new Error(
      `Migration ${file} is a new flat migration; the flat files stop at ${String(LEGACY_LAST).padStart(3, "0")}. Add it as <domain>/${file}.`,
    );
  }

  const bytes = readFileSync(join(directory, file));

  return {
    checksum: createHash("sha256").update(bytes).digest("hex"),
    identity: `${namespace}/${number}`,
    name,
    namespace,
    number: Number(number),
    sql: bytes.toString("utf8"),
  };
}

/** `legacy` first, then `shared`, then every other domain alphabetically. */
function namespaceRank(namespace: string) {
  return namespace === "legacy" ? 0 : namespace === "shared" ? 1 : 2;
}

/**
 * Every migration under `directory` in the order it applies: the flat legacy files, then each
 * `<domain>/NNN-name.sql` (`legacy`, then `shared`, then the other domains alphabetically,
 * numerically within one). A badly named file or a number used twice in a domain throws.
 */
function discover(directory: string) {
  const migrations: Migration[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".sql")) {
      migrations.push(readMigration(directory, "legacy", entry.name));
    } else if (entry.isDirectory()) {
      if (!domainName.test(entry.name) || entry.name === "legacy") {
        throw new Error(
          `Migration directory ${entry.name}/ is not a domain name (a lowercase start, letters, digits and dashes; not "legacy")`,
        );
      }

      const domain = join(directory, entry.name);

      for (const file of readdirSync(domain).filter((name) => name.endsWith(".sql"))) {
        migrations.push(readMigration(domain, entry.name, file));
      }
    }
  }

  const identities = new Set<string>();

  for (const { identity } of migrations) {
    if (identities.has(identity)) {
      throw new Error(`Two migrations are numbered ${identity}`);
    }

    identities.add(identity);
  }

  return migrations.sort(
    (a, b) =>
      namespaceRank(a.namespace) - namespaceRank(b.namespace) ||
      a.namespace.localeCompare(b.namespace) ||
      a.number - b.number,
  );
}

/**
 * Upgrades the `migrations` table the flat-only runner created (`version INTEGER PRIMARY KEY,
 * name, applied_at`) in place: adds `identity` (unique) and `checksum`, and records each existing
 * row as `legacy/NNN`. Its rows otherwise stay as they are; their checksums are recorded the next
 * time their files are read (`migrate`). The schema is read and changed in one `BEGIN IMMEDIATE`
 * transaction, so a second process opening the same database waits, then finds it upgraded.
 */
function upgradeTable(database: DatabaseSync) {
  transaction(database, () => {
    database.exec(`CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`);

    const columns = database.prepare("SELECT name FROM pragma_table_info('migrations')").all();

    if (columns.some((column) => column.name === "identity")) {
      return;
    }

    database.exec(`ALTER TABLE migrations ADD COLUMN identity TEXT;
ALTER TABLE migrations ADD COLUMN checksum TEXT;
UPDATE migrations SET identity = 'legacy/' || printf('%03d', version);
CREATE UNIQUE INDEX migrations_identity ON migrations (identity);`);
  });
}

/**
 * Applies each migration under `directory` (`discover`) once, in order, each in its own
 * transaction, and records its identity and the SHA-256 of its bytes. An applied migration whose
 * file was renamed or whose bytes changed throws: applied migrations are immutable. A row the
 * flat-only runner applied has no checksum yet and gets its file's now.
 *
 * Foreign keys are not enforced while migrations run, so one can rebuild a table other tables
 * point at (SQLite's create-copy-drop-rename); `PRAGMA foreign_key_check` must find no violation
 * before a migration commits, and enforcement is restored afterwards.
 */
export function migrate(database: DatabaseSync, directory: string) {
  upgradeTable(database);

  const enforced = database.prepare("PRAGMA foreign_keys").get()?.foreign_keys === 1;

  // A no-op inside a transaction, so it is set between them.
  database.exec("PRAGMA foreign_keys = OFF");

  try {
    for (const migration of discover(directory)) {
      apply(database, migration);
    }
  } finally {
    if (enforced) {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }
}

/** Applies `migration` unless it was, or checks it is unchanged (`migrate`). */
function apply(database: DatabaseSync, migration: Migration) {
  transaction(database, () => {
    const applied = database
      .prepare("SELECT name, checksum FROM migrations WHERE identity = ?")
      .get(migration.identity);

    if (!applied) {
      database.exec(migration.sql);

      const violation = database.prepare("PRAGMA foreign_key_check").get();

      if (violation) {
        throw new Error(
          `Migration ${migration.identity} (${migration.name}) leaves a row of ${String(violation.table)} pointing at a missing row of ${String(violation.parent)}`,
        );
      }

      database
        .prepare(
          `INSERT INTO migrations (version, name, applied_at, identity, checksum)
          VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          migration.namespace === "legacy" ? migration.number : null,
          migration.name,
          new Date().toISOString(),
          migration.identity,
          migration.checksum,
        );

      return;
    }

    if (applied.name !== migration.name) {
      throw new Error(
        `Migration ${migration.identity} was applied as ${String(applied.name)}, not ${migration.name}`,
      );
    }

    if (applied.checksum === null) {
      database
        .prepare("UPDATE migrations SET checksum = ? WHERE identity = ?")
        .run(migration.checksum, migration.identity);
    } else if (applied.checksum !== migration.checksum) {
      throw new Error(
        `Migration ${migration.identity} (${migration.name}) changed after it was applied: its SHA-256 is ${migration.checksum}, the database recorded ${String(applied.checksum)}. Applied migrations are immutable; restore the file and add a new migration.`,
      );
    }
  });
}
