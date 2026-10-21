import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { z } from "zod";

import { generationSchema } from "../src/features/genjutsu/contracts.ts";
import { recipeSchema } from "../src/features/genjutsu/server/recipe.ts";
import {
  motionTransferModels,
  motionTransferWorkflow,
} from "../src/features/genjutsu/workflows/registry.ts";
import { accessCookie } from "./access-session.mjs";

const base = process.env.BASE_URL;
const id = z.uuid().parse(process.argv[2]);
const vramFile = process.env.VRAM_CSV;

assert.ok(base, "Set BASE_URL to the app running with COMFY_BASE_URL pointed at the pod proxy");

assert.ok(vramFile, "Set VRAM_CSV to the nvidia-smi recording of this one render");

const cookie = await accessCookie(base);

async function get(path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  });

  assert.equal(response.status, 200, path);

  return response;
}

const generation = generationSchema.parse(await (await get(`/api/generations/${id}`)).json());
const recipe = recipeSchema.parse(await (await get(`/api/generations/${id}/recipe.json`)).json());

assert.equal(generation.status, "done");

assert.equal(recipe.target, "selfhost");

assert.equal(recipe.workflow.sha256, motionTransferWorkflow.sha256);

assert.deepEqual(recipe.models, motionTransferModels);

assert.ok(generation.final_asset_id);

assert.ok(generation.submitted_at);

assert.ok(generation.finished_at);

const samples = (await readFile(vramFile, "utf8"))
  .trim()
  .split(/\r?\n/)
  .map((line) =>
    z
      .tuple([
        z.string().min(1),
        z.literal("NVIDIA GeForce RTX 5090"),
        z.coerce.number().nonnegative(),
      ])
      .parse(line.split(",").map((value) => value.trim())),
  );

assert.ok(samples.length >= 2, "Record GPU memory throughout the render at one-second intervals");

const submitted = Date.parse(generation.submitted_at);
const finished = Date.parse(generation.finished_at);
const sampleTime = (sample) => Date.parse(`${sample[0].replaceAll("/", "-").replace(" ", "T")}Z`);

assert.ok(
  samples.every((sample) => Number.isFinite(sampleTime(sample))),
  "Record timestamps with TZ=UTC",
);

assert.ok(sampleTime(samples[0]) <= submitted + 2000, "GPU recording must start before submission");

assert.ok(sampleTime(samples.at(-1)) >= finished - 2000, "GPU recording must continue until done");

const renderSamples = samples.filter(
  (sample) => sampleTime(sample) >= submitted - 1000 && sampleTime(sample) <= finished + 1000,
);

assert.ok(renderSamples.length >= 2, "GPU samples must overlap this generation");

await mkdir("work", { recursive: true });

const videoPath = `work/selfhost-${id}.mp4`;
const response = await get(`/media/${generation.final_asset_id}.mp4`);

assert.ok(response.body);

await pipeline(Readable.fromWeb(response.body), createWriteStream(videoPath));

const video = z
  .object({
    streams: z.array(z.object({ codec_type: z.string(), codec_name: z.string() })),
    format: z.object({ duration: z.coerce.number().positive() }),
  })
  .parse(
    JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath],
        { encoding: "utf8" },
      ),
    ),
  );

assert.ok(
  video.streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264"),
);

assert.ok(
  video.streams.some((stream) => stream.codec_type === "audio"),
  "Use a driving clip with audio for the proof",
);

// Decode both streams to catch corrupt downloads or undecodable output.
execFileSync("ffmpeg", ["-v", "error", "-xerror", "-i", videoPath, "-f", "null", "-"], {
  stdio: "pipe",
});

const report = {
  generation_id: id,
  target: recipe.target,
  gpu: "NVIDIA GeForce RTX 5090",
  variant: "int8 base + lightx2v distillation LoRA, 6 steps",
  resolution: `${recipe.params.width}x${recipe.params.height}`,
  clip_seconds: video.format.duration,
  submitted_to_done_seconds:
    (Date.parse(generation.finished_at) - Date.parse(generation.submitted_at)) / 1000,
  peak_vram_mib: Math.max(...renderSamples.map((sample) => sample[2])),
  vram_samples: renderSamples.length,
  workflow_sha256: recipe.workflow.sha256,
  models: recipe.models,
  output_sha256: createHash("sha256")
    .update(await readFile(videoPath))
    .digest("hex"),
  audio:
    "Present and decodable; compare playback with the source clip before marking the proof complete",
};

await writeFile(`work/selfhost-${id}.json`, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));
