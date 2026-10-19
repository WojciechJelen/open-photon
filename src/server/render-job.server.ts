import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Comfy, ComfyError, type Job, type Progress } from "@comfyorg/sdk";

import type { JobRow, NewJob } from "../lib/contracts.ts";
import { findJob, insertJob, saveWorkflow, updateJob } from "./db.server.ts";
import { saveVideoOutput } from "./video-output.server.ts";
import { buildGraph } from "./workflows/build-graph.ts";
import { loadWorkflow } from "./workflows/registry.ts";

function client() {
  return new Comfy({ clientInfo: "open-photon", timeoutMs: 30_000 });
}

/** The sample inputs, at the template's seed for take 1 and its 482×854 size for portrait. */
async function sampleGraph(comfy: Comfy, input: NewJob) {
  const { graph, inputsMap } = await loadWorkflow("motion-transfer", 1);

  const [reference_image, driving_video] = await Promise.all([
    comfy.assets.fromFile(resolve("fixtures/wan/reference.png")).asReference(),
    comfy.assets.fromFile(resolve("fixtures/wan/driving.mp4")).asReference(),
  ]);

  const portrait = input.preset === "portrait";

  return buildGraph(graph, inputsMap, {
    driving_video,
    frames: 81,
    height: portrait ? 854 : 482,
    prompt: input.prompt,
    reference_image,
    seed: 582_699_151_003_550 + input.take - 1,
    width: portrait ? 482 : 854,
  });
}

const downloads = new Map<string, Promise<JobRow>>();

export async function submitJob(input: NewJob) {
  const { created, job } = insertJob(input);

  if (!created) {
    return job;
  }

  let sending = false;

  try {
    const comfy = client();
    const graph = await sampleGraph(comfy, input);
    saveWorkflow(job.id, graph);
    sending = true;

    const accepted = await comfy.submit(comfy.workflows.fromJson(graph), {
      idempotencyKey: job.id,
    });

    return updateJob(job.id, (current) => ({
      ...current,
      completedAt: null,
      message: "Queued on Comfy",
      percent: null,
      providerJobId: accepted.id,
      status: "queued",
    }));
  } catch (error) {
    const rejected =
      error instanceof ComfyError &&
      error.httpStatus !== undefined &&
      error.httpStatus >= 400 &&
      error.httpStatus < 500 &&
      error.code !== "idempotency_key_reuse";

    const code = error instanceof ComfyError ? (error.code ?? error.name) : "submission_error";
    console.error(
      JSON.stringify({
        code,
        event: "comfy.submission-error",
        httpStatus: error instanceof ComfyError ? error.httpStatus : null,
        jobId: job.id,
        requestId: error instanceof ComfyError ? error.requestId : null,
        stage: sending ? "submit" : "prepare-inputs",
      }),
    );

    if (!sending || rejected) {
      return updateJob(job.id, (current) => ({
        ...current,
        completedAt: Date.now(),
        errorCode: code,
        message: `Comfy could not accept this render (${code}). No video was generated.`,
        percent: null,
        status: "failed",
      }));
    }

    return updateJob(job.id, (current) => ({
      ...current,
      completedAt: null,
      errorCode: "submission_unknown",
      message:
        "Submission was interrupted before its Comfy ID was saved. Check the Comfy queue before starting another render; this request will not be submitted again automatically.",
      percent: null,
      providerJobId: null,
      status: "unknown",
    }));
  }
}

function progressValue(progress: Progress | null) {
  return progress ? Math.min(99, Math.max(0, Math.floor(progress.value * 100))) : null;
}

function observe(
  id: string,
  provider: Job,
  progress = provider.progress,
  status: Job["status"] = provider.status,
) {
  return updateJob(id, (current) => {
    if (current.providerJobId === null) {
      return current;
    }

    const providerJobId = current.providerJobId;

    if (["failed", "canceled", "expired"].includes(status)) {
      return {
        ...current,
        completedAt: provider.completedAt?.getTime() ?? Date.now(),
        errorCode: provider.error?.code ?? status,
        message: `Comfy render ${status}: ${provider.error?.message ?? "No output is available"}`,
        percent: null,
        status: "failed",
      };
    }

    if (status === "succeeded" || current.status === "downloading") {
      return {
        ...current,
        completedAt: null,
        message: "Generation finished. Downloading and checking the MP4.",
        percent: 99,
        providerJobId,
        status: "downloading",
      };
    }

    return {
      ...current,
      completedAt: null,
      message:
        progress?.message ??
        progress?.currentNodeClass ??
        (status === "queued" ? "Queued on Comfy" : "Rendering on Comfy"),
      percent: progressValue(progress) ?? current.percent,
      providerJobId,
      startedAt: provider.startedAt?.getTime() ?? current.startedAt,
      status: status === "queued" ? "queued" : "running",
    };
  });
}

async function collect(id: string, provider: Job, signal?: AbortSignal): Promise<JobRow> {
  const existing = downloads.get(id);

  if (existing) {
    return existing;
  }

  const pending = (async () => {
    const primary = provider
      .getOutputs("246")
      .find((output) => output.contentType === "video/mp4" || output.name.endsWith(".mp4"));

    if (!primary) {
      return updateJob(id, (current) => ({
        ...current,
        completedAt: Date.now(),
        errorCode: "missing_video_output",
        message: "Comfy reported success without the template's MP4 output.",
        percent: null,
        status: "failed",
      }));
    }

    const output = await saveVideoOutput(id, primary, signal);

    return updateJob(id, (current) => {
      if (current.providerJobId === null) {
        throw new Error("Missing provider ID for completed render");
      }

      return {
        ...current,
        completedAt: provider.completedAt?.getTime() ?? Date.now(),
        message: "Render complete. MP4 saved and verified.",
        output,
        percent: 100,
        providerJobId: current.providerJobId,
        status: "complete",
      };
    });
  })();

  downloads.set(id, pending);

  try {
    return await pending;
  } finally {
    if (downloads.get(id) === pending) {
      downloads.delete(id);
    }
  }
}

export async function reconcileJob(id: string, signal?: AbortSignal) {
  const row = findJob(id);

  if (!row || row.status === "complete" || row.status === "failed" || row.status === "unknown") {
    return row;
  }

  if (row.providerJobId === null) {
    if (Date.now() - Date.parse(row.createdAt) > 300_000) {
      return updateJob(id, (current) => ({
        ...current,
        completedAt: null,
        errorCode: "submission_unknown",
        message:
          "No Comfy ID was recorded before the submission stopped. Check Comfy before starting another render.",
        percent: null,
        providerJobId: null,
        status: "unknown",
      }));
    }

    return row;
  }

  signal?.throwIfAborted();
  const provider = await client().jobs.get(row.providerJobId);
  signal?.throwIfAborted();
  const snapshot = observe(id, provider);

  return provider.status === "succeeded" ? collect(id, provider, signal) : snapshot;
}

export async function* jobUpdates(id: string, signal: AbortSignal): AsyncGenerator<JobRow> {
  signal.throwIfAborted();
  let row = findJob(id);

  if (!row) {
    throw new Error("Render not found");
  }

  yield row;

  while (row.status === "submitting") {
    await delay(1000, undefined, { signal });
    row = await reconcileJob(id, signal);

    if (!row) {
      throw new Error("Render not found");
    }

    yield row;
  }

  if (row.status === "complete" || row.status === "failed" || row.status === "unknown") {
    return;
  }

  const provider = await client().jobs.get(row.providerJobId);
  signal.throwIfAborted();
  let status = provider.status;

  for await (const event of provider.events(signal)) {
    if (event.kind === "progress") {
      yield observe(id, provider, event, status);
    }

    if (event.kind === "statusChange") {
      status = event.status;
      yield observe(id, provider, undefined, status);
    }
  }

  await provider.refresh(signal);
  const snapshot = observe(id, provider);
  yield provider.status === "succeeded" ? await collect(id, provider, signal) : snapshot;
}
