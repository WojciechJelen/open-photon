// Renders one params file through the workflow registry on Comfy:
//   node --env-file=.env scripts/render-once.mjs params/first-registry-render.json
// The params file names the driving video and reference image by path. A record under
// work/render-once/ keyed by the recipe (workflow hash, params, input file hashes) holds the
// idempotency key before submit and the job id once Comfy accepts it, so running the same
// params again resumes that job instead of creating another.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Comfy } from "@comfyorg/sdk";
import { z } from "zod";

import { buildGraph } from "../src/server/workflows/build-graph.ts";
import { motionTransferParamsSchema } from "../src/server/workflows/params.ts";
import { loadWorkflow } from "../src/server/workflows/registry.ts";

const paramsFile = process.argv[2];

if (!paramsFile) {
  throw new Error("Usage: node --env-file=.env scripts/render-once.mjs <params.json>");
}

const params = motionTransferParamsSchema
  .extend({ driving_video: z.string().min(1), reference_image: z.string().min(1) })
  .parse(JSON.parse(await readFile(paramsFile, "utf8")));

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const log = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

const workflow = await loadWorkflow("motion-transfer", 1);

const recipe = {
  ...params,
  driving_video: sha256(await readFile(params.driving_video)),
  reference_image: sha256(await readFile(params.reference_image)),
  workflow: `motion-transfer.v1@${workflow.sha256}`,
};

const recipeHash = sha256(JSON.stringify(recipe, Object.keys(recipe).sort())).slice(0, 16);
const directory = "work/render-once";
const recordFile = `${directory}/${recipeHash}.json`;
const videoFile = `${directory}/${recipeHash}.mp4`;

await mkdir(directory, { recursive: true });

let record = { idempotencyKey: randomUUID(), jobId: null, output: null, recipe, recipeHash };

try {
  record = JSON.parse(await readFile(recordFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

const save = () => writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`);
const comfy = new Comfy({ clientInfo: "open-photon", timeoutMs: 30_000 });
let job;

if (record.jobId) {
  job = await comfy.jobs.get(record.jobId);
  log("resume", { jobId: job.id, recipeHash, status: job.status });
} else {
  const [driving_video, reference_image] = await Promise.all([
    comfy.assets.fromFile(resolve(params.driving_video)).asReference(),
    comfy.assets.fromFile(resolve(params.reference_image)).asReference(),
  ]);

  const graph = buildGraph(
    workflow.graph,
    workflow.inputsMap,
    motionTransferParamsSchema.parse({ ...params, driving_video, reference_image }),
  );

  // A record without a job id means an earlier submit may have reached Comfy; reusing its key
  // makes Comfy reject a duplicate (idempotency_key_reuse) instead of rendering twice.
  await save();
  log("submit", { idempotencyKey: record.idempotencyKey, recipeHash });
  job = await comfy.submit(comfy.workflows.fromJson(graph), {
    idempotencyKey: record.idempotencyKey,
  });
  record.jobId = job.id;
  await save();
  log("submitted", { jobId: job.id, status: job.status });
}

const terminal = ["succeeded", "failed", "canceled", "expired"];

if (!terminal.includes(job.status)) {
  let percent = null;

  for await (const event of job.events()) {
    if (event.kind === "statusChange") {
      log("status", { queuePosition: event.queuePosition, status: event.status });
    }

    if (event.kind === "progress" && Math.floor(event.value * 100) !== percent) {
      percent = Math.floor(event.value * 100);
      log("progress", { node: event.currentNodeClass, percent });
    }
  }
}

// The event stream is a hint; the job resource decides whether the render finished.
await job.wait();

log(job.status === "succeeded" ? "complete" : "ended", {
  error: job.error ?? null,
  jobId: job.id,
  metrics: job.metrics ?? null,
  status: job.status,
});

if (job.status !== "succeeded") {
  throw new Error(`Job ${job.id} ended ${job.status}`);
}

if (record.output) {
  log("already-downloaded", record.output);
} else {
  const output = job
    .getOutputs("246")
    .find((candidate) => candidate.contentType === "video/mp4" || candidate.name.endsWith(".mp4"));

  if (!output) {
    throw new Error(`Job ${job.id} has no MP4 output on node 246`);
  }

  const partial = `${videoFile}.part`;
  await output.toFile(partial, { timeoutMs: 180_000 });
  const bytes = await readFile(partial);
  await rename(partial, videoFile);
  record.output = { bytes: bytes.byteLength, path: videoFile, sha256: sha256(bytes) };
  await save();
  log("download", record.output);
}
