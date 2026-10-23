import { rm, stat } from "node:fs/promises";

import { workflows } from "../../../app/server.ts";
import { hashFile, incomingPath, type NewAsset, storeAsset } from "../assets.ts";
import { comfyProvider, type Provider, type ProviderOutput } from "../comfy-provider.ts";
import { cutPoster } from "../media/poster.ts";
import { classifyImage, probe } from "../media/probe.ts";
import { type OutputDeclaration, POSTER_OUTPUT } from "./definition.ts";
import {
  countFinalizeAttempt,
  findGeneration,
  type Generation,
  markFinalizing,
  transition,
} from "./generations.ts";

/** The file of `declared` among what its node produced: an MP4 for a video, a still for an image. */
function pickOutput(candidates: ProviderOutput[], declared: OutputDeclaration) {
  return candidates.find((candidate) =>
    declared.media === "video"
      ? candidate.contentType === "video/mp4" || candidate.name.endsWith(".mp4")
      : candidate.contentType.startsWith("image/") || /\.(?:png|jpe?g|webp)$/i.test(candidate.name),
  );
}

/** Downloads `output` to `path`, checking it is all there. */
async function download(output: ProviderOutput, path: string) {
  await output.toFile(path, { timeoutMs: 180_000 });
  const bytes = (await stat(path)).size;

  if (bytes === 0 || (output.sizeBytes > 0 && output.sizeBytes !== bytes)) {
    throw new Error(`Downloaded ${bytes} bytes of a ${output.sizeBytes}-byte output`);
  }

  return bytes;
}

const stillAsset = { duration_ms: null, fps: null, has_audio: null } as const;

/**
 * Downloads one declared output and stores it as a content-addressed asset: an image as it is
 * (PNG, JPEG or WebP by content); a video as its MP4, with its poster when it declares one.
 * Returns the stored asset ids by output name.
 */
async function rehost(
  output: ProviderOutput,
  declared: OutputDeclaration,
): Promise<Array<[name: string, assetId: string]>> {
  const file = await incomingPath();
  const poster = await incomingPath();

  try {
    const bytes = await download(output, file);
    const info = await probe(file);

    if (declared.media === "image") {
      const image = classifyImage(info);

      if (!image) {
        throw new Error(`The output ${declared.name} is not a PNG, JPEG or WebP image`);
      }

      const stored = await storeAsset(file, {
        ...stillAsset,
        bytes,
        ext: image.ext,
        height: image.height,
        kind: "image",
        mime: image.mime,
        role: "provider_output",
        sha256: await hashFile(file),
        source_asset_id: null,
        width: image.width,
      });

      return [[declared.name, stored.asset.id]];
    }

    if (!info?.video || info.durationMs === null) {
      throw new Error("The output has no video stream ffprobe can read");
    }

    const frame = declared.poster ? await cutPoster(file, poster) : null;

    const video = await storeAsset(file, {
      bytes,
      duration_ms: info.durationMs,
      ext: "mp4",
      fps: info.video.fps,
      has_audio: info.hasAudio,
      height: info.video.height,
      kind: "video",
      mime: "video/mp4",
      role: "provider_output",
      sha256: await hashFile(file),
      source_asset_id: null,
      width: info.video.width,
    });

    if (!frame) {
      return [[declared.name, video.asset.id]];
    }

    const still: NewAsset = {
      ...stillAsset,
      bytes: (await stat(poster)).size,
      ext: "jpg",
      height: frame.height,
      kind: "poster",
      mime: "image/jpeg",
      role: "poster",
      sha256: await hashFile(poster),
      source_asset_id: video.asset.id,
      width: frame.width,
    };

    return [
      [declared.name, video.asset.id],
      [POSTER_OUTPUT, (await storeAsset(poster, still)).asset.id],
    ];
  } finally {
    await rm(file, { force: true });
    await rm(poster, { force: true });
  }
}

// A finalize that failed is tried again on a later read, no sooner than this many milliseconds
// times the failures so far after the last one; the third failure fails the row.
const FINALIZE_BACKOFF_MS = 30_000;
const FINALIZE_ATTEMPTS = 3;

/**
 * Fails a row in flight whose job was submitted to another endpoint than the one `provider`
 * reaches (`target`, `target_origin`; a row stored before origins were recorded is matched by its
 * kind), with `target_mismatch`, and returns it; `null` when `provider` may be asked about it. A
 * local decision, with no provider call: a server whose `COMFY_BASE_URL` changed cannot follow
 * the job, which may still exist on its own endpoint, so it is never resubmitted; a retry renders
 * it anew here. The code is not refunded: the other endpoint accepted the job.
 */
export function failElsewhere(row: Generation, provider: Provider) {
  const current = provider.target?.();

  if (
    !current ||
    !["queued", "running", "finalizing"].includes(row.status) ||
    (row.target === current.kind &&
      (row.target_origin === null || row.target_origin === current.origin))
  ) {
    return null;
  }

  const recorded = row.target_origin ?? row.target;

  console.error(
    JSON.stringify({
      current: current.origin ?? current.kind,
      event: "generation.target-mismatch",
      id: row.id,
      recorded,
    }),
  );

  return transition(row.id, row.status, "failed", {
    error_code: "target_mismatch",
    error_message: `This generation was submitted to ${recorded}, not to the endpoint this server renders on now (${current.origin ?? current.kind}), so it cannot be followed from here. Its job may still exist there; a retry renders it again here.`,
  });
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

  const elsewhere = failElsewhere(row, provider);

  if (elsewhere) {
    return elsewhere;
  }

  if (
    row.finalize_attempted_at !== null &&
    Date.now() < Date.parse(row.finalize_attempted_at) + row.finalize_attempts * FINALIZE_BACKOFF_MS
  ) {
    return row;
  }

  const definition = workflows.find(row);

  if (!definition) {
    throw new Error(
      `Generation ${id} is a ${row.workflow_id} v${row.workflow_version} generation, a workflow no feature registers in src/app/server.ts`,
    );
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

  const files = definition.outputs.map((declared) => ({
    declared,
    output: pickOutput(job.getOutputs(declared.nodeId), declared),
  }));

  const missing = files.find(({ output }) => !output);

  if (missing) {
    return transition(id, current.status, "failed", {
      error_code: "provider_failed",
      error_message: `Comfy finished the job without its ${missing.declared.media === "video" ? "MP4" : "image"} output.`,
    });
  }

  const started = markFinalizing(id);

  if (!started) {
    return findGeneration(id);
  }

  try {
    const stored = [];

    for (const { declared, output } of files) {
      if (output) {
        stored.push(...(await rehost(output, declared)));
      }
    }

    return transition(id, "finalizing", "done", { outputs: Object.fromEntries(stored) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    if (countFinalizeAttempt(id).finalize_attempts < FINALIZE_ATTEMPTS) {
      throw error;
    }

    console.error(JSON.stringify({ event: "finalize.failed", id, message }));

    return transition(id, "finalizing", "failed", {
      error_code: "finalize_failed",
      error_message: `Comfy finished the job, but its output could not be downloaded and stored after ${FINALIZE_ATTEMPTS} attempts (${message}). The Comfy job ${started.provider_job_id} stays valid: its output is in your Comfy history.`,
    });
  }
}

const finalizing = new Map<string, Promise<Generation | null>>();

/**
 * Finishes a generation whose Comfy job is complete: downloads each output its workflow declares
 * (`OutputDeclaration`; a Motion Transfer MP4 already carries the driving clip's audio), cuts a
 * poster for a video output that asks for one, stores them as hashed assets under their names and
 * moves the row to `done`. `jobs.get` decides: while the job is not complete the row is left
 * untouched; a failed, cancelled or expired job fails it. One run per id at a time; concurrent
 * callers share it. A failed download or FFmpeg run throws and leaves the row `finalizing`; a
 * call within the backoff after it returns the row without asking Comfy, a later one tries again,
 * and the third failure fails the row (`finalize_failed`) instead of throwing.
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
