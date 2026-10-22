import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { migrate } from "./migrate.ts";
import { databasePath } from "./paths.ts";

// Resolved from the working directory, like the workflows; the Dockerfile copies it (with its
// `<domain>/` subdirectories) next to `.output`.
const MIGRATIONS_DIRECTORY = resolve("src/shared/server/migrations");

const path = databasePath();

mkdirSync(dirname(path), { recursive: true });

/**
 * The process's one SQLite connection, migrated when this module loads. Seeding is not done here:
 * features' seeders run from `src/app/server.ts` (`seedDatabase`).
 */
export const database = new DatabaseSync(path);

database.exec(`PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;`);

migrate(database, MIGRATIONS_DIRECTORY);
