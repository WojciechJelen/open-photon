import { readFile, rm, stat } from "node:fs/promises";

import { TEXT_OUTPUT_MAX_BYTES } from "../../contracts.ts";
import { hashFile, incomingPath, type NewAsset, storeAsset } from "../assets.ts";
import { comfyProvider, type Provider, type ProviderOutput } from "../comfy-provider.ts";
import { cutPoster } from "../media/poster.ts";
import { classifyImage, probe } from "../media/probe.ts";
import {
  type AnyWorkflowDefinition,
  type OutputDeclaration,
  outputFileName,
  POSTER_OUTPUT,
  workflows,
} from "./definition.ts";
import {
  addOutputs,
  countFinalizeAttempt,
  findGeneration,
  type Generation,
  markFinalizing,
  readOutputs,
  transition,
} from "./generations.ts";

/** Whether `candidate` is the kind of file `declared` asks for: an MP4, a still, or a text. */
function isDeclaredKind(candidate: ProviderOutput, declared: OutputDeclaration) {
  switch (declared.media) {
    case "video":
      return candidate.contentType === "video/mp4" || candidate.name.endsWith(".mp4");
    case "image":
      return (
        candidate.contentType.startsWith("image/") || /\.(?:png|jpe?g|webp)$/i.test(candidate.name)
      );
    case "text":
      return (
        candidate.type === "text" ||
        candidate.contentType.startsWith("text/") ||
        /\.txt$/i.test(candidate.name)
      );
  }
}

/** The words a missing output of `declared`'s media is named by in a failure. */
const missingNames = { image: "image", text: "text", video: "MP4" } as const;

/**
 * An output that came down whole but cannot be stored as its workflow declares it (a blank or
 * oversized text): no attempt will do better, so the generation fails at once.
 */
class UnusableOutput extends Error {}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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

const textAsset = { ...stillAsset, height: null, width: null } as const;

/**
 * Downloads the text outputs of a `text` declaration in Comfy's order and stores the first that is
 * not blank, byte for byte, as a private `.txt` asset. A text that is not UTF-8 or is longer than
 * `TEXT_OUTPUT_MAX_BYTES`, or no text that is not blank, is an `UnusableOutput`.
 */
async function rehostText(
  outputs: ProviderOutput[],
  declared: OutputDeclaration,
): Promise<Array<[name: string, assetId: string]>> {
  for (const output of outputs) {
    const file = await incomingPath();

    try {
      await output.toFile(file, { timeoutMs: 180_000 });
      const bytes = await readFile(file);

      if (output.sizeBytes > 0 && output.sizeBytes !== bytes.length) {
        throw new Error(`Downloaded ${bytes.length} bytes of a ${output.sizeBytes}-byte output`);
      }

      if (bytes.length > TEXT_OUTPUT_MAX_BYTES) {
        throw new UnusableOutput(
          `Comfy's text output ${declared.name} is ${bytes.length} bytes, more than the ${TEXT_OUTPUT_MAX_BYTES} a text output may hold.`,
        );
      }

      let text: string;

      try {
        text = utf8.decode(bytes);
      } catch {
        throw new UnusableOutput(`Comfy's text output ${declared.name} is not UTF-8 text.`);
      }

      if (text.trim() === "") {
        continue;
      }

      const stored = await storeAsset(file, {
        ...textAsset,
        bytes: bytes.length,
        ext: "txt",
        kind: "text",
        mime: "text/plain; charset=utf-8",
        role: "provider_output",
        sha256: await hashFile(file),
        source_asset_id: null,
      });

      return [[declared.name, stored.asset.id]];
    } finally {
      await rm(file, { force: true });
    }
  }

  throw new UnusableOutput(
    `Comfy finished the job, but its text output ${declared.name} is blank.`,
  );
}

/**
 * Downloads the file at `index` (in Comfy's order) of one declared output and stores it as a
 * content-addressed asset under `outputFileName(declared.name, index)`: an image as it is (PNG,
 * JPEG or WebP by content); a video as its MP4, with its poster (`poster`, `poster-2`, … by the
 * same index) when it declares one. Returns the stored asset ids by output name.
 */
async function rehost(
  output: ProviderOutput,
  declared: OutputDeclaration,
  index: number,
): Promise<Array<[name: string, assetId: string]>> {
  const name = outputFileName(declared.name, index);
  const file = await incomingPath();
  const poster = await incomingPath();

  try {
    const bytes = await download(output, file);
    const info = await probe(file);

    if (declared.media === "image") {
      const image = classifyImage(info);

      if (!image) {
        throw new Error(`The output ${name} is not a PNG, JPEG or WebP image`);
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

      return [[name, stored.asset.id]];
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
      return [[name, video.asset.id]];
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
      [name, video.asset.id],
      [outputFileName(POSTER_OUTPUT, index), (await storeAsset(poster, still)).asset.id],
    ];
  } finally {
    await rm(file, { force: true });
    await rm(poster, { force: true });
  }
}

/**
 * The outputs `definition.deriveOutputs` makes from a row's stored `outputs`; none when it has no
 * such hook, or when it throws, which is logged and never counts as a failed finalize.
 */
async function derive(
  definition: AnyWorkflowDefinition,
  row: Generation,
  outputs: Readonly<Record<string, string>>,
) {
  if (!definition.deriveOutputs) {
    return {};
  }

  try {
    return await definition.deriveOutputs(definition.recipeSchema.parse(row.recipe), outputs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(JSON.stringify({ event: "finalize.derive-failed", id: row.id, message }));

    return {};
  }
}

/**
 * Adds to a `done` generation the outputs its workflow derives (`deriveOutputs`) that it does not
 * have yet: for a row finished before its workflow derived them, by hand
 * (`scripts/backfill-compare.mjs`). Returns the names added: none for a row that is not done or
 * whose workflow derives nothing, or when the derivation fails (logged, as in `finalize`).
 */
export async function deriveForDone(id: string) {
  const row = findGeneration(id);
  const definition = row?.status === "done" ? workflows.find(row) : undefined;

  if (!row || !definition) {
    return [];
  }

  const stored = Object.fromEntries(readOutputs(id).map(({ asset, name }) => [name, asset.id]));
  const derived = await derive(definition, row, stored);

  return addOutputs(
    id,
    Object.fromEntries(Object.entries(derived).filter(([name]) => !(name in stored))),
  );
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
    candidates: job
      .getOutputs(declared.nodeId)
      .filter((candidate) => isDeclaredKind(candidate, declared)),
    declared,
  }));

  const missing = files.find(({ candidates }) => candidates.length === 0);

  if (missing) {
    return transition(id, current.status, "failed", {
      error_code: "provider_failed",
      error_message: `Comfy finished the job without its ${missingNames[missing.declared.media]} output.`,
    });
  }

  const started = markFinalizing(id);

  if (!started) {
    return findGeneration(id);
  }

  try {
    const stored = [];

    for (const { candidates, declared } of files) {
      if (declared.media === "text") {
        stored.push(...(await rehostText(candidates, declared)));
        continue;
      }

      for (const [index, candidate] of candidates.entries()) {
        stored.push(...(await rehost(candidate, declared, index)));
      }
    }

    const outputs = Object.fromEntries(stored);
    const derived = await derive(definition, started, outputs);

    return transition(id, "finalizing", "done", { outputs: { ...derived, ...outputs } });
  } catch (error) {
    if (error instanceof UnusableOutput) {
      return transition(id, "finalizing", "failed", {
        error_code: "provider_failed",
        error_message: error.message,
      });
    }

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
 * Finishes a generation whose Comfy job is complete: downloads every file of each image or video
 * output its workflow declares (`OutputDeclaration`: the first under its name, further ones under
 * `outputFileName`; a Motion Transfer MP4 already carries the driving clip's audio) and a text
 * output's first text that is not blank, cuts a poster for each file of a video output that asks
 * for one, stores them as hashed assets under their names,
 * adds the outputs its workflow derives from them (`deriveOutputs`; one that fails is left out)
 * and moves the row to `done`. `jobs.get` decides: while the job is not complete the row is left
 * untouched; a failed, cancelled or expired job fails it. One run per id at a time; concurrent
 * callers share it. A failed download or FFmpeg run throws and leaves the row `finalizing`; a
 * call within the backoff after it returns the row without asking Comfy, a later one tries again,
 * and the third failure fails the row (`finalize_failed`) instead of throwing. A text output that
 * came down but cannot be stored (blank, not UTF-8, too long) fails the row at once
 * (`provider_failed`): no attempt would do better.
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
