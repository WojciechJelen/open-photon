import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { databasePath } from "./paths.ts";
import { seedSamples } from "./samples.ts";

// Resolved from the working directory, like `workflows/`; the Dockerfile copies it next to `.output`.
const MIGRATIONS_DIRECTORY = resolve("src/server/migrations");

const path = databasePath();

mkdirSync(dirname(path), { recursive: true });

/** The process's one SQLite connection. */
export const database = new DatabaseSync(path);

database.exec(`PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;`);

function transaction<T>(operation: () => T): T {
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

/** Applies each `NNN-name.sql` in `src/server/migrations` once, in order, each in its own transaction. */
function migrate() {
  database.exec(`CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`);

  const files = readdirSync(MIGRATIONS_DIRECTORY)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = /^(\d{3})-[a-z0-9-]+\.sql$/.exec(file)?.[1];

    if (!version) {
      throw new Error(`Migration ${file} is not named NNN-name.sql`);
    }

    transaction(() => {
      const applied = database
        .prepare("SELECT name FROM migrations WHERE version = ?")
        .get(Number(version));

      if (applied) {
        if (applied.name !== file) {
          throw new Error(
            `Migration ${version} was applied as ${String(applied.name)}, not ${file}`,
          );
        }

        return;
      }

      database.exec(readFileSync(join(MIGRATIONS_DIRECTORY, file), "utf8"));
      database
        .prepare("INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(Number(version), file, new Date().toISOString());
    });
  }
}

migrate();

// Every database gets the sample characters before its first query: a fresh clone, test or volume.
transaction(() => seedSamples(database));
