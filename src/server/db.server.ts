import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { jobRowSchema, type NewJob } from "#/lib/contracts";

function withDatabase<T>(operation: (db: DatabaseSync) => T): T {
	const path = resolve(process.env.DATABASE_PATH ?? "data/spike.sqlite");
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	try {
		db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        preset TEXT NOT NULL CHECK (preset IN ('cinematic', 'portrait')),
        take INTEGER NOT NULL CHECK (take BETWEEN 1 AND 9),
        created_at TEXT NOT NULL
      );
    `);
		return operation(db);
	} finally {
		db.close();
	}
}

export function insertJob(input: NewJob) {
	return withDatabase((db) => {
		const row = db
			.prepare(`
      INSERT INTO jobs (id, prompt, preset, take, created_at)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, prompt, preset, take, created_at AS createdAt
    `)
			.get(
				randomUUID(),
				input.prompt,
				input.preset,
				input.take,
				new Date().toISOString(),
			);
		return jobRowSchema.parse(row);
	});
}

export function findJob(id: string) {
	return withDatabase((db) => {
		const row = db
			.prepare(
				"SELECT id, prompt, preset, take, created_at AS createdAt FROM jobs WHERE id = ?",
			)
			.get(id);
		return row ? jobRowSchema.parse(row) : null;
	});
}
