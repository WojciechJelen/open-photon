import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { jobRowSchema, type NewJob, newJobSchema } from "../lib/contracts.ts";

const storedJobSchema = newJobSchema.extend({
	id: z.uuid(),
	createdAt: z.iso.datetime(),
	startedAt: z.number().int(),
	durationMs: z.number().int().positive(),
	completedAt: z.number().int().nullable(),
});
const columns =
	"id, prompt, preset, take, created_at AS createdAt, started_at AS startedAt, duration_ms AS durationMs, completed_at AS completedAt";

function withDatabase<T>(operation: (db: DatabaseSync) => T): T {
	const path = resolve(process.env.DATABASE_PATH ?? "data/spike.sqlite");
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	try {
		db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, prompt TEXT NOT NULL,
        preset TEXT NOT NULL CHECK (preset IN ('cinematic', 'portrait')),
        take INTEGER NOT NULL CHECK (take BETWEEN 1 AND 9), created_at TEXT NOT NULL,
        started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL, completed_at INTEGER
      );`);
		const names = z
			.array(z.object({ name: z.string() }))
			.parse(db.prepare("PRAGMA table_info(jobs)").all())
			.map((column) => column.name);
		if (!names.includes("started_at"))
			db.exec(
				"ALTER TABLE jobs ADD COLUMN started_at INTEGER NOT NULL DEFAULT 0",
			);
		if (!names.includes("duration_ms"))
			db.exec(
				"ALTER TABLE jobs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 10000",
			);
		if (!names.includes("completed_at"))
			db.exec("ALTER TABLE jobs ADD COLUMN completed_at INTEGER");
		db.exec(
			"UPDATE jobs SET started_at = CAST(strftime('%s', created_at) AS INTEGER) * 1000 WHERE started_at = 0",
		);
		return operation(db);
	} finally {
		db.close();
	}
}

function snapshot(value: unknown, now: number) {
	const row = storedJobSchema.parse(value);
	return jobRowSchema.parse(
		row.completedAt === null
			? {
					...row,
					status: "running",
					percent: Math.min(
						99,
						Math.max(
							0,
							Math.floor(((now - row.startedAt) / row.durationMs) * 100),
						),
					),
				}
			: { ...row, status: "complete", percent: 100 },
	);
}

export function insertJob(
	input: NewJob,
	{
		now = Date.now(),
		durationMs = Number(process.env.FAKE_JOB_DURATION_MS ?? 10000),
	} = {},
) {
	const duration = z.number().int().min(100).max(3600000).parse(durationMs);
	return withDatabase((db) =>
		snapshot(
			db
				.prepare(`INSERT INTO jobs (id, prompt, preset, take, created_at, started_at, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`)
				.get(
					randomUUID(),
					input.prompt,
					input.preset,
					input.take,
					new Date(now).toISOString(),
					now,
					duration,
				),
			now,
		),
	);
}

export function findJob(id: string, { now = Date.now() } = {}) {
	return withDatabase((db) => {
		db.prepare(
			"UPDATE jobs SET completed_at = started_at + duration_ms WHERE id = ? AND completed_at IS NULL AND started_at + duration_ms <= ?",
		).run(id, now);
		const row = db.prepare(`SELECT ${columns} FROM jobs WHERE id = ?`).get(id);
		return row ? snapshot(row, now) : null;
	});
}
