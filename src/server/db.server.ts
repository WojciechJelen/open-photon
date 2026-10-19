import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { type JobRow, jobRowSchema, type NewJob } from "../lib/contracts.ts";

// Resolved from the working directory, like `workflows/`; the Dockerfile copies it next to `.output`.
const MIGRATIONS_DIRECTORY = resolve("src/server/migrations");

const path = resolve(process.env.DATABASE_PATH ?? "data/spike.sqlite");

mkdirSync(dirname(path), { recursive: true });

/** The process's one SQLite connection. */
const database = new DatabaseSync(path);

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

export function findJob(id: string) {
  const row = database.prepare("SELECT state_json FROM renders WHERE id = ?").get(id);

  if (!row) {
    return null;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- sqlite returns SQLOutputValue; jobRowSchema parses the payload on the next line.
  if (typeof row.state_json !== "string") {
    throw new Error("Invalid stored render");
  }

  return jobRowSchema.parse(JSON.parse(row.state_json));
}

export function insertJob(input: NewJob) {
  const job: JobRow = {
    ...input,
    completedAt: null,
    createdAt: new Date().toISOString(),
    message: "Uploading the sample inputs and submitting to Comfy",
    percent: null,
    providerJobId: null,
    startedAt: null,
    status: "submitting",
  };

  const result = database
    .prepare("INSERT OR IGNORE INTO renders(id, state_json) VALUES (?, ?)")
    .run(job.id, JSON.stringify(job));

  const stored = findJob(job.id);

  if (!stored) {
    throw new Error("Could not persist render");
  }

  if (
    stored.prompt !== input.prompt ||
    stored.preset !== input.preset ||
    stored.take !== input.take
  ) {
    throw new Error("This request ID already belongs to different inputs");
  }

  return { created: result.changes === 1, job: stored };
}

export function updateJob(id: string, transition: (job: JobRow) => JobRow) {
  return transaction(() => {
    const current = findJob(id);

    if (!current) {
      throw new Error("Render not found");
    }

    const next =
      current.status === "complete" || current.status === "failed"
        ? current
        : jobRowSchema.parse(transition(current));

    database
      .prepare("UPDATE renders SET provider_job_id = ?, state_json = ? WHERE id = ?")
      .run(next.providerJobId, JSON.stringify(next), id);

    return next;
  });
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- opaque ComfyUI workflow JSON, stored verbatim and never read as a domain type here.
export function saveWorkflow(id: string, graph: unknown) {
  database
    .prepare("UPDATE renders SET workflow_json = ? WHERE id = ?")
    .run(JSON.stringify(graph), id);
}
