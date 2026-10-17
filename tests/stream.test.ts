import assert from "node:assert/strict";
import test from "node:test";
import { jobEventSchema } from "../src/lib/contracts.ts";
import { streamFakeJob } from "../src/server/fake-job.server.ts";

test("stream completes in order and closes after the final event", async () => {
	const response = streamFakeJob(
		new Request("http://localhost/events"),
		crypto.randomUUID(),
	);
	assert.match(
		response.headers.get("content-type") ?? "",
		/text\/event-stream/,
	);
	const events = (await response.text())
		.split("\n\n")
		.filter(Boolean)
		.map((line) => jobEventSchema.parse(JSON.parse(line.slice(6))));
	assert.deepEqual(
		events.map((event) => event.percent),
		[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
	);
	assert.equal(events.at(-1)?.kind, "complete");
});

test("aborting a connected request closes the stream", async () => {
	const controller = new AbortController();
	const response = streamFakeJob(
		new Request("http://localhost/events", { signal: controller.signal }),
		crypto.randomUUID(),
	);
	assert.ok(response.body);
	const reader = response.body.getReader();
	assert.equal((await reader.read()).done, false);
	controller.abort();
	assert.equal((await reader.read()).done, true);
});

test("a request aborted before connection creates no active stream", async () => {
	const controller = new AbortController();
	controller.abort();
	const response = streamFakeJob(
		new Request("http://localhost/events", { signal: controller.signal }),
		crypto.randomUUID(),
	);
	assert.equal(await response.text(), "");
});

test("consumer cancellation clears the interval", async () => {
	const response = streamFakeJob(
		new Request("http://localhost/events"),
		crypto.randomUUID(),
	);
	assert.ok(response.body);
	const reader = response.body.getReader();
	await reader.read();
	await reader.cancel();
	assert.equal((await reader.read()).done, true);
});
