import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { jobRowSchema } from "../src/lib/contracts.ts";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3030";
const container = process.env.SPIKE_CONTAINER ?? "comfy-start-spike";
const context = process.env.SPIKE_DOCKER_CONTEXT ?? "colima";
const report = {};
function docker(...args) {
	const result = spawnSync("docker", ["--context", context, ...args], {
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}
function containerMemory() {
	const lines = docker(
		"exec",
		container,
		"sh",
		"-c",
		"cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.stat",
	).split("\n");
	const current = Number(lines.shift());
	const stats = new Map(
		lines.map((line) => {
			const [key, value] = line.split(" ");
			return [key, Number(value)];
		}),
	);
	const anon = stats.get("anon"),
		inactiveFile = stats.get("inactive_file");
	assert.ok(
		anon > 0 && Number.isFinite(current) && Number.isFinite(inactiveFile),
	);
	return {
		current,
		anon,
		file: stats.get("file"),
		inactiveFile,
		workingSet: current - inactiveFile,
	};
}
async function status() {
	return (await fetch(`${base}/api/spike/status`)).json();
}
async function job() {
	const id = process.env.SPIKE_JOB_ID;
	assert.ok(
		id,
		"Set SPIKE_JOB_ID to an existing render. Verification never submits a billable generation.",
	);
	const response = await fetch(`${base}/api/jobs/${id}`);
	assert.equal(response.status, 200);
	return jobRowSchema.parse(await response.json());
}

async function ready() {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			if ((await fetch(base)).ok) return;
		} catch {}
		await delay(200);
	}
	throw new Error("Container did not become ready");
}
function curl(...args) {
	return new Promise((resolve, reject) => {
		const child = spawn("curl", ["--silent", "--show-error", ...args]);
		let out = "",
			error = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			error += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve(out)
				: reject(new Error(error || `curl exited ${code}`)),
		);
	});
}

await ready();
for (const method of ["HEAD", "GET"]) {
	const response = await fetch(`${base}/media/x.mp4`, {
		method,
		headers: { Range: "bytes=0-99" },
	});
	assert.equal(response.status, 206);
	assert.match(response.headers.get("content-range") ?? "", /^bytes 0-99\//);
	assert.equal(
		(await response.arrayBuffer()).byteLength,
		method === "HEAD" ? 0 : 100,
	);
}
report.range =
	"GET and HEAD return 206, Content-Range, and the correct byte count";
const html = await (await fetch(`${base}/r/test`)).text();
for (const tag of ["og:title", "og:image", "og:video", "og:url"])
	assert.ok(html.includes(`property="${tag}"`), `Raw HTML must include ${tag}`);
report.ssr = "Open Graph tags present in raw HTML";
const row = await job();
const before = await status();
const controller = new AbortController();
const stream = await fetch(`${base}/api/jobs/${row.id}/events`, {
	signal: controller.signal,
});
assert.equal(stream.headers.get("x-accel-buffering"), "no");
assert.match(stream.headers.get("cache-control") ?? "", /no-cache/);
assert.ok(stream.body);
const reader = stream.body.getReader();
await reader.read();
controller.abort();
await reader.cancel().catch(() => {});
await delay(200);
const after = await status();
assert.equal(after.streams.active, 0);
assert.ok(
	after.streams.requestAborts > before.streams.requestAborts ||
		after.streams.completed > before.streams.completed,
);
report.abort = { before: before.streams, after: after.streams };
report.proxyHeaders = "no-cache, no-transform and X-Accel-Buffering: no";

const restartJob = row;
docker("restart", "--time", "1", container);
await ready();
const recovered = jobRowSchema.parse(
	await (await fetch(`${base}/api/jobs/${restartJob.id}`)).json(),
);
assert.equal(recovered.providerJobId, restartJob.providerJobId);
if (restartJob.status === "complete") {
	assert.equal(recovered.status, "complete");
	assert.equal(recovered.output.sha256, restartJob.output.sha256);
}
report.restart = {
	jobId: restartJob.id,
	providerJobId: recovered.providerJobId,
	status: recovered.status,
	url: `${base}/studio?preset=${recovered.preset}&take=${recovered.take}&job=${recovered.id}`,
};

await mkdir("work", { recursive: true });
const sample = await readFile("fixtures/x.mp4");
await writeFile("work/upload-100MiB.mp4", sample);
const { truncate } = await import("node:fs/promises");
await truncate("work/upload-100MiB.mp4", 100 * 1024 * 1024);
const warmUpload = JSON.parse(
	await curl("-F", "file=@fixtures/x.mp4", `${base}/api/uploads`),
);
const baseline = (await status()).memory;
const containerBaseline = containerMemory();
const containerPeak = { ...containerBaseline };
const peak = { ...baseline };
let uploading = true;
const upload = curl(
	"--limit-rate",
	"10M",
	"-F",
	"file=@work/upload-100MiB.mp4",
	`${base}/api/uploads`,
).finally(() => {
	uploading = false;
});
while (uploading) {
	const current = (await status()).memory;
	const sample = containerMemory();
	for (const key of Object.keys(containerPeak))
		containerPeak[key] = Math.max(containerPeak[key], sample[key]);
	for (const key of ["rss", "heapUsed", "external", "arrayBuffers"])
		peak[key] = Math.max(peak[key], current[key]);
	await delay(100);
}
const uploaded = JSON.parse(await upload);
assert.equal(uploaded.bytes, 100 * 1024 * 1024);
console.log(
	JSON.stringify({ containerBaseline, containerPeak, baseline, peak }),
);
assert.ok(
	containerPeak.anon - containerBaseline.anon < 64 * 1024 * 1024 &&
		peak.arrayBuffers < 64 * 1024 * 1024,
	"Streaming 100 MiB must keep anonymous-memory growth and upload buffers below 64 MiB",
);
const uploadedHead = await fetch(`${base}${uploaded.url}`, {
	method: "HEAD",
	headers: { Range: "bytes=0-99" },
});
assert.equal(uploadedHead.status, 206);
report.upload = {
	bytes: uploaded.bytes,
	processRssAvailable: baseline.rss > 0,
	containerBaseline,
	containerPeak,
	workingSetDelta: containerPeak.workingSet - containerBaseline.workingSet,
	anonDelta: containerPeak.anon - containerBaseline.anon,
	heapDelta: peak.heapUsed - baseline.heapUsed,
	arrayBuffersPeak: peak.arrayBuffers,
	externalPeak: peak.external,
	thresholdBasis:
		"64 MiB each for anonymous-memory growth and array-buffer peak; filesystem cache is reported separately",
	url: uploaded.url,
};
await writeFile("work/upload-129MiB.mp4", sample);
await truncate("work/upload-129MiB.mp4", 129 * 1024 * 1024);
const oversize = await curl(
	"-o",
	"work/oversize.json",
	"-w",
	"%{http_code}",
	"-F",
	"file=@work/upload-129MiB.mp4",
	`${base}/api/uploads`,
);
assert.equal(oversize, "413");
const chunked = await curl(
	"-o",
	"work/chunked.json",
	"-w",
	"%{http_code}",
	"-H",
	"Transfer-Encoding: chunked",
	"-F",
	"file=@work/upload-129MiB.mp4",
	`${base}/api/uploads`,
);
assert.equal(chunked, "413");
report.upload.limit =
	"128 MiB file limit; both declared and chunked 129 MiB requests return 413";
report.runtime = docker(
	"exec",
	container,
	"sh",
	"-c",
	"uname -m; node --version; ffmpeg -version | head -n 1",
);
await writeFile(
	"work/video-checks.json",
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));

docker(
	"exec",
	container,
	"node",
	"--input-type=module",
	"-e",
	`import {unlinkSync} from 'node:fs';for(const name of JSON.parse(process.argv[1]))unlinkSync('/app/data/media/'+name)`,
	JSON.stringify([warmUpload.filename, uploaded.filename]),
);
const { rm } = await import("node:fs/promises");
await rm("work/upload-100MiB.mp4", { force: true });
await rm("work/upload-129MiB.mp4", { force: true });
