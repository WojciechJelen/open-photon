// Checks generations a self-hosted pod rendered against the workflows this checkout runs, by id:
//   BASE_URL=… ACCESS_CODE=… VRAM_CSV=gpu.csv node scripts/verify-selfhost.mjs <generation id> …
// Each one is `done` on target `selfhost`, with this checkout's workflow file (SHA-256) and model
// pins, and the outputs its workflow declares: a Motion Transfer take's MP4 with audio, a caption
// enhancement's non-empty caption, a character image's PNG at its recipe's size. VRAM_CSV is
// `nvidia-smi --query-gpu=timestamp,name,memory.used --format=csv,noheader,nounits -l 1` recorded
// with TZ=UTC from before the first submission until the last one is done; it must hold samples
// during each generation, whose peak it reports. Writes work/selfhost-<id>.{json,mp4,png}.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { z } from "zod";

import {
  characterCaptionWorkflow,
  characterImageWorkflow,
} from "../src/features/characterBuilder/workflows/registry.ts";
import { recipeSchema } from "../src/features/motionTransfer/server/recipe.ts";
import {
  motionTransferModels,
  motionTransferWorkflow,
} from "../src/features/motionTransfer/workflows/registry.ts";
import { generationSchema } from "../src/shared/contracts.ts";
import { accessCookie } from "./access-session.mjs";

const base = process.env.BASE_URL;
const vramFile = process.env.VRAM_CSV;

const ids = z
  .array(z.uuid())
  .min(1, "Pass the ids of the generations to check")
  .parse(process.argv.slice(2));

assert.ok(base, "Set BASE_URL to the app running with COMFY_BASE_URL pointed at the pod proxy");

assert.ok(vramFile, "Set VRAM_CSV to the nvidia-smi recording of these renders");

const cookie = await accessCookie(base);

async function get(path) {
  const response = await fetch(`${base}${path}`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30_000),
  });

  assert.equal(response.status, 200, path);

  return response;
}

/** Downloads `/media/<asset id>.<extension>` to `work/selfhost-<id>.<extension>`. */
async function download(id, assetId, extension) {
  const path = `work/selfhost-${id}.${extension}`;
  const response = await get(`/media/${assetId}.${extension}`);

  assert.ok(response.body);

  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));

  return path;
}

const sha256 = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const samples = (await readFile(vramFile, "utf8"))
  .trim()
  .split(/\r?\n/)
  .map((line) =>
    z
      .tuple([z.string().min(1), z.string().min(1), z.coerce.number().nonnegative()])
      .parse(line.split(",").map((value) => value.trim())),
  );

const gpus = [...new Set(samples.map((sample) => sample[1]))];

assert.equal(gpus.length, 1, "Record one GPU (nvidia-smi --id=0)");

const sampleTime = (sample) => Date.parse(`${sample[0].replaceAll("/", "-").replace(" ", "T")}Z`);

assert.ok(
  samples.every((sample) => Number.isFinite(sampleTime(sample))),
  "Record timestamps with TZ=UTC",
);

/** The VRAM samples taken while `generation` ran, checked to cover it from submission to done. */
function generationSamples(generation) {
  assert.ok(generation.submitted_at);

  assert.ok(generation.finished_at);

  const submitted = Date.parse(generation.submitted_at);
  const finished = Date.parse(generation.finished_at);

  assert.ok(
    sampleTime(samples[0]) <= submitted + 2000,
    "GPU recording must start before submission",
  );

  assert.ok(
    sampleTime(samples.at(-1)) >= finished - 2000,
    "GPU recording must continue until done",
  );

  const during = samples.filter(
    (sample) => sampleTime(sample) >= submitted - 1000 && sampleTime(sample) <= finished + 1000,
  );

  assert.ok(during.length >= 2, `GPU samples must overlap generation ${generation.id}`);

  return during;
}

/** Motion Transfer: one H.264 MP4 with the driving clip's audio, decodable end to end. */
async function checkMotionTransfer(id, generation, recipeJson) {
  const recipe = recipeSchema.parse(recipeJson);

  assert.equal(recipe.target, "selfhost");

  assert.equal(recipe.workflow.sha256, motionTransferWorkflow.sha256);

  assert.deepEqual(recipe.models, motionTransferModels);

  assert.ok(generation.final_asset_id);

  const videoPath = await download(id, generation.final_asset_id, "mp4");

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

  return {
    variant: "int8 base + lightx2v distillation LoRA, 6 steps",
    resolution: `${recipe.params.width}x${recipe.params.height}`,
    clip_seconds: video.format.duration,
    models: recipe.models,
    output_sha256: await sha256(videoPath),
    audio:
      "Present and decodable; compare playback with the source clip before marking the proof complete",
  };
}

// What every character recipe records about where and with what it rendered; the definitions'
// own strict schemas live with them, which open the database, so this script reads only these.
const characterRecipeSchema = z.object({
  models: z.array(z.strictObject({ file: z.string(), license: z.string(), sha256: z.string() })),
  target: z.enum(["cloud", "selfhost"]),
  workflow: z.strictObject({ id: z.string(), sha256: z.string(), version: z.int() }),
});

function checkCharacterRecipe(recipe, workflow) {
  assert.equal(recipe.target, "selfhost");

  assert.equal(recipe.workflow.sha256, workflow.sha256);

  assert.deepEqual(recipe.models, workflow.models);
}

/** Caption enhancement: the upsampler's caption, inline and not blank. */
function checkCaption(_id, generation, recipeJson) {
  const recipe = characterRecipeSchema.parse(recipeJson);

  checkCharacterRecipe(recipe, characterCaptionWorkflow);

  const caption = generation.outputs.find((output) => output.name === "caption");

  assert.equal(caption?.media, "text", "A caption generation has the text output caption");

  assert.ok(caption.text.trim(), "The caption is not blank");

  return {
    models: recipe.models,
    caption_characters: caption.text.length,
    caption_sha256: createHash("sha256").update(caption.text).digest("hex"),
  };
}

/** Character image: one PNG, as stored and as served, at the size its recipe asked for. */
async function checkImage(id, generation, recipeJson) {
  const recipe = characterRecipeSchema
    .extend({ height: z.int().positive(), width: z.int().positive() })
    .parse(recipeJson);

  checkCharacterRecipe(recipe, characterImageWorkflow);

  const image = generation.outputs.find((output) => output.name === "image");

  assert.equal(image?.media, "image", "A character generation has the image output image");

  assert.equal(image.asset.mime, "image/png");

  const path = await download(id, image.asset.id, "png");
  const bytes = await readFile(path);

  assert.ok(
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "The image is a PNG",
  );

  // IHDR, the first chunk: width and height, big-endian, at bytes 16 and 20.
  assert.equal(bytes.toString("latin1", 12, 16), "IHDR");

  const size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };

  assert.deepEqual(size, { width: recipe.width, height: recipe.height });

  assert.deepEqual({ width: image.asset.width, height: image.asset.height }, size);

  const outputSha256 = createHash("sha256").update(bytes).digest("hex");

  assert.equal(outputSha256, image.asset.sha256, "The download is the stored file");

  return {
    models: recipe.models,
    resolution: `${size.width}x${size.height}`,
    output_sha256: outputSha256,
  };
}

const checks = {
  "motion-transfer": checkMotionTransfer,
  "character-caption": checkCaption,
  "character-generation": checkImage,
};

await mkdir("work", { recursive: true });

const reports = [];

for (const id of ids) {
  const generation = generationSchema.parse(await (await get(`/api/generations/${id}`)).json());
  const recipeJson = await (await get(`/api/generations/${id}/recipe.json`)).json();

  const workflowId = z
    .object({ workflow: z.object({ id: z.enum(Object.keys(checks)) }) })
    .parse(recipeJson).workflow.id;

  assert.equal(generation.status, "done", id);

  const during = generationSamples(generation);
  const outputs = await checks[workflowId](id, generation, recipeJson);

  const report = {
    generation_id: id,
    workflow: workflowId,
    target: "selfhost",
    gpu: gpus[0],
    submitted_to_done_seconds:
      (Date.parse(generation.finished_at) - Date.parse(generation.submitted_at)) / 1000,
    peak_vram_mib: Math.max(...during.map((sample) => sample[2])),
    vram_samples: during.length,
    workflow_sha256: recipeJson.workflow.sha256,
    ...outputs,
  };

  await writeFile(`work/selfhost-${id}.json`, `${JSON.stringify(report, null, 2)}\n`);

  reports.push(report);
}

console.log(JSON.stringify(reports, null, 2));

for (const report of reports) {
  console.log(`${report.workflow} ${report.generation_id}: peak ${report.peak_vram_mib} MiB`);
}
