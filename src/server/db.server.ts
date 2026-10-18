import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { type JobRow, jobRowSchema, type NewJob } from "../lib/contracts.ts";

function withDatabase<T>(operation: (db: DatabaseSync) => T): T {
  const path = resolve(process.env.DATABASE_PATH ?? "data/spike.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  try {
    db.exec(`PRAGMA busy_timeout = 5000;
   CREATE TABLE IF NOT EXISTS renders (
    id TEXT PRIMARY KEY, provider_job_id TEXT UNIQUE,
    state_json TEXT NOT NULL CHECK(json_valid(state_json)),
    workflow_json TEXT CHECK(workflow_json IS NULL OR json_valid(workflow_json))
   );`);

    return operation(db);
  } finally {
    db.close();
  }
}

function read(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT state_json FROM renders WHERE id = ?").get(id);

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

  return withDatabase((db) => {
    const result = db
      .prepare("INSERT OR IGNORE INTO renders(id, state_json) VALUES (?, ?)")
      .run(job.id, JSON.stringify(job));

    const stored = read(db, job.id);

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
  });
}

export function findJob(id: string) {
  return withDatabase((db) => read(db, id));
}

export function updateJob(id: string, transition: (job: JobRow) => JobRow) {
  return withDatabase((db) => {
    db.exec("BEGIN IMMEDIATE");

    try {
      const current = read(db, id);

      if (!current) {
        throw new Error("Render not found");
      }

      const next =
        current.status === "complete" || current.status === "failed"
          ? current
          : jobRowSchema.parse(transition(current));

      db.prepare("UPDATE renders SET provider_job_id = ?, state_json = ? WHERE id = ?").run(
        next.providerJobId,
        JSON.stringify(next),
        id,
      );
      db.exec("COMMIT");

      return next;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- opaque ComfyUI workflow JSON, stored verbatim and never read as a domain type here.
export function saveWorkflow(id: string, graph: unknown) {
  withDatabase((db) =>
    db.prepare("UPDATE renders SET workflow_json = ? WHERE id = ?").run(JSON.stringify(graph), id),
  );
}
