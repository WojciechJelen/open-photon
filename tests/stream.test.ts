import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { jobEventSchema } from "../src/lib/contracts.ts";
import { findJob, insertJob } from "../src/server/db.server.ts";
import {
	streamDiagnostics,
	streamFakeJob,
} from "../src/server/fake-job.server.ts";

const directory = mkdtempSync(join(tmpdir(), "comfy-stream-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
after(() => rmSync(directory, { recursive: true, force: true }));
function job() {
	return insertJob(
		{ prompt: "Test", preset: "cinematic", take: 1 },
		{ durationMs: 600 },
	);
}

test("stream completes incrementally and persists completion", async () => {
	const row = job();
	const response = streamFakeJob(
		new Request("http://localhost/events"),
		row.id,
	);
	assert.match(
		response.headers.get("content-type") ?? "",
		/text\/event-stream/,
	);
	assert.equal(response.headers.get("x-accel-buffering"), "no");
	assert.match(response.headers.get("cache-control") ?? "", /no-cache/);
	const events = (await response.text())
		.split("\n\n")
		.filter(Boolean)
		.map((line) => jobEventSchema.parse(JSON.parse(line.slice(6))));
	assert.ok(events.length > 1);
	assert.equal(events.at(-1)?.kind, "complete");
	assert.deepEqual(
		events.map((event) => event.percent),
		events.map((event) => event.percent).sort((a, b) => a - b),
	);
	assert.equal(findJob(row.id)?.status, "complete");
	assert.equal(streamDiagnostics().active, 0);
});
test("aborting a request fires cleanup and closes its stream", async () => {
	const row = job(),
		controller = new AbortController();
	const response = streamFakeJob(
		new Request("http://localhost/events", { signal: controller.signal }),
		row.id,
	);
	assert.ok(response.body);
	const reader = response.body.getReader();
	await reader.read();
	const before = streamDiagnostics().requestAborts;
	controller.abort();
	assert.equal((await reader.read()).done, true);
	assert.equal(streamDiagnostics().requestAborts, before + 1);
	assert.equal(streamDiagnostics().active, 0);
});
test("pre-aborted requests have no active subscription", async () => {
	const controller = new AbortController();
	controller.abort();
	const response = streamFakeJob(
		new Request("http://localhost/events", { signal: controller.signal }),
		job().id,
	);
	assert.equal(await response.text(), "");
	assert.equal(streamDiagnostics().active, 0);
});
test("consumer cancellation clears the timer", async () => {
	const response = streamFakeJob(
		new Request("http://localhost/events"),
		job().id,
	);
	assert.ok(response.body);
	const reader = response.body.getReader();
	await reader.read();
	await reader.cancel();
	assert.equal((await reader.read()).done, true);
	assert.equal(streamDiagnostics().active, 0);
});
test("lazy reads recover and finalize an elapsed job exactly once", () => {
	const row = insertJob(
		{ prompt: "Restart proof", preset: "portrait", take: 2 },
		{ now: 100000, durationMs: 1000 },
	);
	assert.equal(findJob(row.id, { now: 100500 })?.percent, 50);
	const complete = findJob(row.id, { now: 101100 });
	assert.equal(complete?.status, "complete");
	assert.equal(complete?.completedAt, 101000);
	assert.deepEqual(findJob(row.id, { now: 200000 }), complete);
});
