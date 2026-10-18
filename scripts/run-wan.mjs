import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { jobEventSchema, jobRowSchema } from "../src/lib/contracts.ts";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3030";
const runFile = process.env.WAN_RUN_FILE ?? "work/wan-run.json";
const directory = resolve(process.env.WAN_OUTPUT_DIRECTORY ?? "data/renders");
await mkdir("work", { recursive: true });
await mkdir(directory, { recursive: true });
let record;
try {
	record = JSON.parse(await readFile(runFile, "utf8"));
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}
if (!record) {
	record = {
		input: {
			id: randomUUID(),
			prompt:
				"Character Description: Cartoon character lost. Background description: The background is an empty white room.",
			preset: "portrait",
			take: 1,
		},
	};
	await writeFile(runFile, `${JSON.stringify(record, null, 2)}\n`);
}
const response = await fetch(`${base}/api/jobs`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(record.input),
	signal: AbortSignal.timeout(180000),
});
assert.equal(response.status, 201);
let job = jobRowSchema.parse(await response.json());
record.job = job;
await writeFile(runFile, `${JSON.stringify(record, null, 2)}\n`);
console.log(
	JSON.stringify({
		event: "submission-result",
		id: job.id,
		providerJobId: job.providerJobId,
		status: job.status,
		message: job.message,
	}),
);
if (job.status === "failed" || job.status === "unknown")
	throw new Error(job.message);

async function snapshot() {
	const response = await fetch(`${base}/api/jobs/${job.id}`, {
		signal: AbortSignal.timeout(180000),
	});
	assert.equal(response.status, 200);
	return jobRowSchema.parse(await response.json());
}
if (
	process.env.WAN_RESTART_AFTER_ACCEPT === "1" &&
	job.status !== "complete" &&
	!record.restart
) {
	job = await snapshot();
	if (job.status !== "complete" && job.status !== "failed") {
		const providerJobId = job.providerJobId;
		const result = spawnSync(
			"docker",
			[
				"--context",
				process.env.SPIKE_DOCKER_CONTEXT ?? "colima",
				"restart",
				"--time",
				"1",
				process.env.SPIKE_CONTAINER ?? "comfy-start-spike",
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		let ready = false;
		for (let attempt = 0; attempt < 160; attempt++) {
			try {
				if ((await fetch(base, { signal: AbortSignal.timeout(5000) })).ok) {
					ready = true;
					break;
				}
			} catch {}
			await delay(250);
		}
		assert.ok(ready, "App did not recover after restart");
		job = await snapshot();
		assert.equal(job.providerJobId, providerJobId);
		record.restart = {
			providerJobId,
			recoveredStatus: job.status,
			passed: true,
		};
		await writeFile(runFile, `${JSON.stringify(record, null, 2)}\n`);
		console.log(
			JSON.stringify({ event: "restart-recovered", ...record.restart }),
		);
	}
}
const deadline = Date.now() + 45 * 60 * 1000;
while (!["complete", "failed", "unknown"].includes(job.status)) {
	assert.ok(
		Date.now() < deadline,
		"Run still pending; rerun this command to resume this exact job",
	);
	const controller = new AbortController();
	const stream = await fetch(`${base}/api/jobs/${job.id}/events`, {
		signal: controller.signal,
	});
	assert.equal(stream.status, 200);
	assert.equal(stream.headers.get("x-accel-buffering"), "no");
	let pending = "";
	try {
		for await (const chunk of stream.body) {
			pending += new TextDecoder().decode(chunk);
			while (pending.includes("\n\n")) {
				const boundary = pending.indexOf("\n\n");
				const frame = pending.slice(0, boundary);
				pending = pending.slice(boundary + 2);
				if (!frame.startsWith("data: ")) continue;
				job = jobEventSchema.parse(JSON.parse(frame.slice(6))).job;
				record.job = job;
				await writeFile(runFile, `${JSON.stringify(record, null, 2)}\n`);
				const event = {
					event: "progress",
					id: job.id,
					providerJobId: job.providerJobId,
					status: job.status,
					percent: job.percent,
					message: job.message,
				};
				await appendFile(
					"work/wan-live-events.ndjson",
					`${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`,
				);
				console.log(JSON.stringify(event));
			}
			if (["complete", "failed", "unknown"].includes(job.status)) {
				controller.abort();
				break;
			}
			if (Date.now() >= deadline) {
				controller.abort();
				break;
			}
		}
	} catch (error) {
		if (error.name !== "AbortError" && Date.now() >= deadline) throw error;
	}
	if (!["complete", "failed", "unknown"].includes(job.status)) {
		await delay(2000);
		job = await snapshot();
	}
}
assert.equal(job.status, "complete", job.message);
const video = await fetch(`${base}/media/${job.output.filename}`);
assert.equal(video.status, 200);
const path = resolve(directory, job.output.filename);
await pipeline(Readable.fromWeb(video.body), createWriteStream(path));
const hash = createHash("sha256");
for await (const chunk of createReadStream(path)) hash.update(chunk);
assert.equal(hash.digest("hex"), job.output.sha256);
const range = await fetch(`${base}/media/${job.output.filename}`, {
	headers: { Range: "bytes=0-99" },
});
assert.equal(range.status, 206);
assert.equal((await range.arrayBuffer()).byteLength, 100);
const share = await (await fetch(`${base}/r/${job.id}`)).text();
assert.ok(share.includes(job.output.filename));
assert.ok(share.includes('property="og:video"'));
const duplicate = await fetch(`${base}/api/jobs`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(record.input),
});
const same = jobRowSchema.parse(await duplicate.json());
assert.equal(same.providerJobId, job.providerJobId);
assert.equal(same.status, "complete");
record.job = job;
record.localOutput = path;
record.range = "passed";
record.ssr = "passed";
record.duplicateRequest = "same completed provider job, no resubmission";
await writeFile(runFile, `${JSON.stringify(record, null, 2)}\n`);
console.log(
	JSON.stringify({
		event: "verified",
		id: job.id,
		providerJobId: job.providerJobId,
		path,
		...job.output,
	}),
);
