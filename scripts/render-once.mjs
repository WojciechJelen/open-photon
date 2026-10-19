// Renders one params file through the workflow registry on Comfy:
//   node --env-file=.env scripts/render-once.mjs params/first-registry-render.json
// The params file names the driving video and reference image by path. A record under
// work/render-once/ keyed by the recipe (workflow hash, params, input file hashes) tracks the
// render, so running the same params again resumes its job instead of creating another:
//   claimed     one run owns the recipe and has sent nothing to Comfy yet
//   submitting  a submit was sent and its job id never saved: Comfy may be rendering it
//   submitted   jobId names the accepted job
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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

let record = {
  idempotencyKey: randomUUID(),
  jobId: null,
  output: null,
  recipe,
  recipeHash,
  state: "claimed",
};

const temporary = `${recordFile}.${process.pid}.tmp`;
const writeTemporary = () => writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);

const save = async () => {
  await writeTemporary();
  await rename(temporary, recordFile);
};

// link() refuses to replace an existing record, so exactly one run claims a recipe, and other
// runs never see a half-written file.
let claimed = true;

await writeTemporary();

try {
  await link(temporary, recordFile);
} catch (error) {
  if (error.code !== "EEXIST") {
    throw error;
  }

  claimed = false;
  record = JSON.parse(await readFile(recordFile, "utf8"));
} finally {
  await unlink(temporary);
}

if (!record.jobId && !claimed) {
  console.error(
    record.state === "submitting"
      ? `${recordFile}: a submit was sent at ${record.submittedAt} with idempotency key ${record.idempotencyKey} and its job id was never saved, so Comfy may be rendering it. This script will not submit it again: Comfy forgets idempotency keys after 24 hours, so a resubmit could start a second paid job. Find the job in Comfy Cloud, set "jobId" in the record and run again to resume it. Delete the record only once you are sure Comfy created no job.`
      : `${recordFile}: another run is preparing this recipe, or one stopped before submitting. Nothing was submitted. If no other run is active, delete the record and run again.`,
  );
  process.exit(1);
}

const comfy = new Comfy({ clientInfo: "open-photon", timeoutMs: 30_000 });
let job;

if (record.jobId) {
  job = await comfy.jobs.get(record.jobId);
  log("resume", { jobId: job.id, recipeHash, status: job.status });
} else {
  let graph;

  try {
    const [driving_video, reference_image] = await Promise.all([
      comfy.assets.fromFile(resolve(params.driving_video)).asReference(),
      comfy.assets.fromFile(resolve(params.reference_image)).asReference(),
    ]);

    graph = buildGraph(
      workflow.graph,
      workflow.inputsMap,
      motionTransferParamsSchema.parse({ ...params, driving_video, reference_image }),
    );
  } catch (error) {
    // Nothing was submitted, so the next run may claim the recipe again.
    await unlink(recordFile);
    throw error;
  }

  // From here until the job id is saved, a crash leaves the record unresolved, and later runs
  // refuse to submit it again.
  record.state = "submitting";
  record.submittedAt = new Date().toISOString();
  await save();
  log("submit", { idempotencyKey: record.idempotencyKey, recipeHash });
  job = await comfy.submit(comfy.workflows.fromJson(graph), {
    idempotencyKey: record.idempotencyKey,
  });
  record.jobId = job.id;
  record.state = "submitted";
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

  const partial = `${videoFile}.${process.pid}.part`;
  await output.toFile(partial, { timeoutMs: 180_000 });
  const bytes = await readFile(partial);
  await rename(partial, videoFile);
  record.output = { bytes: bytes.byteLength, path: videoFile, sha256: sha256(bytes) };
  await save();
  log("download", record.output);
}
