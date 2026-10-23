import "./temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { characterGenerationInputSchema } from "../src/features/characterBuilder/contracts.ts";
import { characterGenerationDefinition } from "../src/features/characterBuilder/workflows/definition.ts";
import type { Recipe } from "../src/features/motionTransfer/server/recipe.ts";
import { motionTransferDefinition } from "../src/features/motionTransfer/workflows/definition.ts";
import { findAsset, hashFile, incomingPath, storeAsset } from "../src/shared/server/assets.ts";
import type { Provider, ProviderJob, ProviderOutput } from "../src/shared/server/comfy-provider.ts";
import { database } from "../src/shared/server/db.server.ts";
import { finalize } from "../src/shared/server/generation/finalize.ts";
import {
  countInFlight,
  createGeneration,
  findGeneration,
  markQueued,
  readOutputs,
  transition,
} from "../src/shared/server/generation/generations.ts";
import { probe, runTool } from "../src/shared/server/media/probe.ts";
import { assetsDirectory } from "../src/shared/server/paths.ts";

// The rows here are Motion Transfer's, on Comfy Cloud.
const cloud = { kind: "cloud", origin: null } as const;

let seed = 0;

/** A Motion Transfer row Comfy is rendering, driven by the clip `driving` names (none stored by default). */
function running(driving = "a".repeat(64)) {
  seed += 1;

  const recipe: Recipe = {
    inputs: { driving_video_sha256: driving, reference_image_sha256: "b".repeat(64) },
    models: [],
    params: { fragment_length: 81, height: 848, prompt: "A dancer", seed, width: 480 },
    target: "cloud",
    workflow: { id: "motion-transfer", sha256: "c".repeat(64), version: 1 },
  };

  const { id } = markQueued(
    createGeneration(motionTransferDefinition, { recipe, target: cloud }).id,
    randomUUID(),
  );

  return transition(id, "queued", "running");
}

/** A provider whose job has `status` and, on node `nodeId` (Motion Transfer's 246), `outputs`. */
function provider(status: string, outputs: ProviderOutput[] = [], nodeId = "246") {
  const job: ProviderJob = {
    error: null,
    events: () => {
      throw new Error("finalize never subscribes to events");
    },
    getOutputs: (node) => (node === nodeId ? outputs : []),
    id: "provider-job",
    status,
  };

  const double: Provider = {
    job: () => Promise.resolve(job),
    submit: () => Promise.reject(new Error("finalize never submits")),
    upload: () => Promise.reject(new Error("finalize never uploads")),
  };

  return double;
}

/** An output Comfy lists, downloaded as a copy of `fixture`. */
function copyOf(fixture: string, contentType: string): ProviderOutput {
  return {
    contentType,
    name: fixture.split("/").at(-1) ?? fixture,
    sizeBytes: 0,
    toFile: async (path) => {
      await copyFile(fixture, path);

      return path;
    },
  };
}

/** Stores `fixture` as an uploaded clip, as the wizard does before a take; returns its SHA-256. */
async function storeClip(fixture: string) {
  const temporary = await incomingPath();
  await copyFile(fixture, temporary);
  const info = await probe(temporary);
  const sha256 = await hashFile(temporary);

  await storeAsset(temporary, {
    bytes: (await stat(temporary)).size,
    duration_ms: info?.durationMs ?? null,
    ext: "mp4",
    fps: info?.video?.fps ?? null,
    has_audio: info?.hasAudio ?? null,
    height: info?.video?.height ?? null,
    kind: "video",
    mime: "video/mp4",
    role: "upload",
    sha256,
    source_asset_id: null,
    width: info?.video?.width ?? null,
  });

  return sha256;
}

const outputNames = (id: string) => readOutputs(id).map(({ name }) => name);

test("a job Comfy still reports running leaves the row untouched, however old it is", async () => {
  const row = running();
  database
    .prepare("UPDATE generations SET created_at = ?, submitted_at = ? WHERE id = ?")
    .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", row.id);
  const before = findGeneration(row.id);

  assert.deepEqual(await finalize(row.id, provider("running")), before);
  assert.deepEqual(findGeneration(row.id), before);
});

test("a completed job is downloaded once, hashed, given a poster and marked done", async () => {
  const row = running();
  let downloads = 0;

  const output: ProviderOutput = {
    contentType: "video/mp4",
    name: "result.mp4",
    sizeBytes: 0,
    toFile: async (path) => {
      downloads += 1;
      await copyFile("fixtures/x.mp4", path);

      return path;
    },
  };

  const double = provider("succeeded", [output]);
  const [first, second] = await Promise.all([finalize(row.id, double), finalize(row.id, double)]);

  assert.equal(downloads, 1);
  assert.deepEqual(first, second);
  assert.equal(first?.status, "done");
  assert.equal(first?.progress, 100);
  assert.ok(first?.finished_at);

  const video = findAsset(first?.final_asset_id ?? "");
  const poster = findAsset(first?.poster_asset_id ?? "");

  assert.equal(video?.role, "provider_output");
  assert.equal(video?.sha256, await hashFile("fixtures/x.mp4"));
  assert.equal(video?.sha256, await hashFile(resolve(assetsDirectory(), video?.path ?? "")));
  assert.deepEqual(
    [poster?.role, poster?.kind, poster?.mime, poster?.width, poster?.height],
    ["poster", "poster", "image/jpeg", video?.width, video?.height],
  );
  assert.equal(poster?.sha256, await hashFile(resolve(assetsDirectory(), poster?.path ?? "")));
});

test("an output shorter than half a second gets its first frame as the poster", async () => {
  const output: ProviderOutput = {
    contentType: "video/mp4",
    name: "short.mp4",
    sizeBytes: 0,
    toFile: async (path) => {
      // Three frames: 0.3 s, nothing at 0.5 s.
      await runTool("ffmpeg", [
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=64x48:rate=10",
        "-t",
        "0.3",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "mp4",
        path,
      ]);

      return path;
    },
  };

  const row = await finalize(running().id, provider("succeeded", [output]));
  const poster = findAsset(row?.poster_asset_id ?? "");

  assert.equal(row?.status, "done");
  assert.deepEqual([poster?.kind, poster?.width, poster?.height], ["poster", 64, 48]);
});

test("a job that failed or expired on Comfy fails the row with its reason", async () => {
  for (const [status, code] of [
    ["failed", "provider_failed"],
    ["canceled", "provider_failed"],
    ["expired", "timeout"],
  ]) {
    const row = await finalize(running().id, provider(status ?? ""));

    assert.deepEqual([row?.status, row?.error_code], ["failed", code]);
    assert.match(row?.error_message ?? "", new RegExp(`${status} on Comfy`));
  }
});

test("an output that cannot be finalized is retried after a backoff, then fails the row and frees its place", async () => {
  const row = running();
  let downloads = 0;

  const output: ProviderOutput = {
    contentType: "video/mp4",
    name: "garbage.mp4",
    sizeBytes: 0,
    toFile: async (path) => {
      downloads += 1;
      await writeFile(path, "not a video");

      return path;
    },
  };

  const double = provider("succeeded", [output]);
  const inFlight = countInFlight();

  // Moves the last failure back in time, past its backoff.
  const backoffOver = database.prepare(
    "UPDATE generations SET finalize_attempted_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
  );

  await assert.rejects(finalize(row.id, double), /ffprobe/);

  // Within the backoff the row comes back as it is: nothing is downloaded again.
  assert.equal((await finalize(row.id, double))?.status, "finalizing");
  assert.equal(downloads, 1);

  backoffOver.run(row.id);
  await assert.rejects(finalize(row.id, double), /ffprobe/);
  backoffOver.run(row.id);

  const failed = await finalize(row.id, double);

  assert.equal(downloads, 3);
  assert.deepEqual(
    [failed?.status, failed?.error_code, failed?.finalize_attempts],
    ["failed", "finalize_failed", 3],
  );
  assert.ok(failed?.error_message?.includes(row.provider_job_id ?? "no job id"));
  assert.equal(countInFlight(), inFlight - 1);
});

test("a done Motion Transfer take has a compare output: an H.264 and AAC portrait MP4 as long as its result", async () => {
  const row = running(await storeClip("tests/fixtures/short-2s.mp4"));
  const result = copyOf("tests/fixtures/result-5s.mp4", "video/mp4");
  const done = await finalize(row.id, provider("succeeded", [result]));

  assert.equal(done?.status, "done");
  assert.deepEqual(outputNames(row.id), ["compare", "poster", "video"]);

  const outputs = readOutputs(row.id);
  const compare = findAsset(outputs.find(({ name }) => name === "compare")?.asset.id ?? "");
  const video = findAsset(outputs.find(({ name }) => name === "video")?.asset.id ?? "");

  const { stdout } = await runTool("ffprobe", [
    "-print_format",
    "json",
    "-show_streams",
    resolve(assetsDirectory(), compare?.path ?? ""),
  ]);

  const streams: Array<{ codec_name: string; codec_type: string; pix_fmt?: string }> =
    JSON.parse(stdout).streams;

  assert.deepEqual(
    streams.map(({ codec_name, codec_type, pix_fmt }) => [codec_type, codec_name, pix_fmt]),
    [
      ["video", "h264", "yuv420p"],
      ["audio", "aac", undefined],
    ],
  );
  assert.deepEqual([compare?.width, compare?.height], [1080, 1920]);
  assert.deepEqual([compare?.role, compare?.source_asset_id], ["final", video?.id]);
  assert.ok(
    Math.abs((compare?.duration_ms ?? 0) - (video?.duration_ms ?? 0)) <= 1000 / (video?.fps ?? 1),
    `${compare?.duration_ms} ms against a ${video?.duration_ms} ms result`,
  );
});

test("a take whose side-by-side cannot be stitched is done without it, and no finalize failure is counted", async () => {
  // Its driving clip is not stored, so FFmpeg has nothing to put on the left.
  const row = running();
  const result = copyOf("tests/fixtures/result-5s.mp4", "video/mp4");
  const done = await finalize(row.id, provider("succeeded", [result]));

  assert.deepEqual([done?.status, done?.finalize_attempts], ["done", 0]);
  assert.deepEqual(outputNames(row.id), ["poster", "video"]);
});

test("a character image is done with its image output only, never a compare", async () => {
  const { recipe } = characterGenerationDefinition.prepareRecipe(
    characterGenerationInputSchema.parse({ caption: "A knight in plain armour.", seed: 7 }),
    { target: cloud },
  );

  const { id } = markQueued(
    createGeneration(characterGenerationDefinition, { recipe, target: cloud }).id,
    randomUUID(),
  );

  transition(id, "queued", "running");

  const image = copyOf("tests/fixtures/fake-output.png", "image/png");
  const done = await finalize(id, provider("succeeded", [image], "9"));

  assert.equal(done?.status, "done");
  assert.deepEqual(outputNames(id), ["image"]);
});
