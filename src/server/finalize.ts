import { rm, stat } from "node:fs/promises";

import { hashFile, incomingPath, storeAsset } from "./assets.ts";
import { comfyProvider, OUTPUT_NODE, type Provider, type ProviderOutput } from "./comfy.ts";
import {
  countFinalizeAttempt,
  findGeneration,
  type Generation,
  transition,
} from "./generations.ts";
import { probe, runTool } from "./media/probe.ts";

/** The output's frame at 0.5 s as a JPEG, or its first frame when it ends before then. */
async function cutPoster(video: string, poster: string) {
  const cut = ["-i", video, "-frames:v", "1", "-f", "mjpeg", poster];

  const seeked = await runTool("ffmpeg", ["-ss", "0.5", ...cut]).then(
    () => probe(poster),
    () => null,
  );

  const frame = seeked?.video ? seeked : await runTool("ffmpeg", cut).then(() => probe(poster));

  if (!frame?.video) {
    throw new Error("FFmpeg wrote a poster ffprobe cannot read");
  }

  return frame.video;
}

/** Downloads the output MP4 and cuts its poster; stores both as content-addressed assets. */
async function rehost(output: ProviderOutput) {
  const video = await incomingPath();
  const poster = await incomingPath();

  try {
    await output.toFile(video, { timeoutMs: 180_000 });
    const bytes = (await stat(video)).size;

    if (bytes === 0 || (output.sizeBytes > 0 && output.sizeBytes !== bytes)) {
      throw new Error(`Downloaded ${bytes} bytes of a ${output.sizeBytes}-byte output`);
    }

    const info = await probe(video);

    if (!info?.video || info.durationMs === null) {
      throw new Error("The output has no video stream ffprobe can read");
    }

    const frame = await cutPoster(video, poster);

    const stored = await storeAsset(video, {
      bytes,
      duration_ms: info.durationMs,
      ext: "mp4",
      fps: info.video.fps,
      has_audio: info.hasAudio,
      height: info.video.height,
      kind: "video",
      mime: "video/mp4",
      role: "provider_output",
      sha256: await hashFile(video),
      source_asset_id: null,
      width: info.video.width,
    });

    const still = await storeAsset(poster, {
      bytes: (await stat(poster)).size,
      duration_ms: null,
      ext: "jpg",
      fps: null,
      has_audio: null,
      height: frame.height,
      kind: "poster",
      mime: "image/jpeg",
      role: "poster",
      sha256: await hashFile(poster),
      source_asset_id: stored.asset.id,
      width: frame.width,
    });

    return { poster: still.asset, video: stored.asset };
  } finally {
    await rm(video, { force: true });
    await rm(poster, { force: true });
  }
}

async function settle(id: string, provider: Provider) {
  const row = findGeneration(id);

  if (
    !row ||
    row.provider_job_id === null ||
    !["queued", "running", "finalizing"].includes(row.status)
  ) {
    return row;
  }

  const job = await provider.job(row.provider_job_id);
  // Read again: the event stream may have moved the row while Comfy answered.
  const current = findGeneration(id);

  if (!current || !["queued", "running", "finalizing"].includes(current.status)) {
    return current;
  }

  if (["failed", "canceled", "expired"].includes(job.status)) {
    return transition(id, current.status, "failed", {
      error_code: job.status === "expired" ? "timeout" : "provider_failed",
      error_message: `The job ${job.status} on Comfy${job.error ? `: ${job.error.message}` : "."}`,
    });
  }

  // Only Comfy's word completes a job; elapsed time never does.
  if (job.status !== "succeeded") {
    return current;
  }

  const output = job
    .getOutputs(OUTPUT_NODE)
    .find((candidate) => candidate.contentType === "video/mp4" || candidate.name.endsWith(".mp4"));

  if (!output) {
    return transition(id, current.status, "failed", {
      error_code: "provider_failed",
      error_message: "Comfy finished the job without its MP4 output.",
    });
  }

  if (current.status !== "finalizing") {
    transition(id, current.status, "finalizing");
  }

  try {
    const { poster, video } = await rehost(output);

    return transition(id, "finalizing", "done", {
      final_asset_id: video.id,
      output_asset_id: video.id,
      poster_asset_id: poster.id,
    });
  } catch (error) {
    countFinalizeAttempt(id);
    throw error;
  }
}

const finalizing = new Map<string, Promise<Generation | null>>();

/**
 * Finishes a generation whose Comfy job is complete: downloads the MP4 (the template already
 * carries the driving clip's audio), cuts a poster at 0.5 s, stores both as hashed assets and
 * moves the row to `done`. `jobs.get` decides: while the job is not complete the row is left
 * untouched; a failed, cancelled or expired job fails it. One run per id at a time; concurrent
 * callers share it. A failed download leaves the row `finalizing` for the next call.
 */
export function finalize(id: string, provider: Provider = comfyProvider) {
  const pending = finalizing.get(id);

  if (pending) {
    return pending;
  }

  const run = settle(id, provider).finally(() => finalizing.delete(id));
  finalizing.set(id, run);

  return run;
}
