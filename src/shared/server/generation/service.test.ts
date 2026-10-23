import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { isPublicRequest, workflows } from "../../../app/server.ts";
import { findAccessCode } from "../access-codes.ts";
import { findAsset } from "../assets.ts";
import { fakeProvider } from "../comfy-provider.fake.ts";
import { providerTarget } from "../comfy-target.ts";
import { database } from "../db.server.ts";
import { buildGraph, inputsMapSchema, workflowGraphSchema } from "../workflow-graph.ts";
import type { WorkflowDefinition } from "./definition.ts";
import { createGeneration, findGeneration, markSubmitting, readOutputs } from "./generations.ts";
import { readGenerationResult, readGenerationShare } from "./pages.ts";
import { readGeneration, submit } from "./service.ts";

// `comfyProvider` (the default of every call below) is the fake. The target still resolves, as
// the fake needs (`.env.example`): a self-hosted dead port, so nothing could reach a real Comfy.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

/** A text-to-image graph in API format: scalar inputs only, one `SaveImage` output. */
const template = workflowGraphSchema.parse({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "test.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "" } },
  "3": { class_type: "EmptyLatentImage", inputs: { batch_size: 1, height: 512, width: 512 } },
  "4": {
    class_type: "KSampler",
    inputs: { latent_image: ["3", 0], model: ["1", 0], positive: ["2", 0], seed: 0 },
  },
  "5": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["1", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "test", images: ["5", 0] } },
});

const inputsMap = inputsMapSchema(["prompt", "seed", "width", "height"]).parse({
  inputs: {
    height: { class_type: "EmptyLatentImage", field: "height", node: "3" },
    prompt: { class_type: "CLIPTextEncode", field: "text", node: "2" },
    seed: { class_type: "KSampler", field: "seed", node: "4" },
    width: { class_type: "EmptyLatentImage", field: "width", node: "3" },
  },
  workflow: "test-image.v1.json",
});

const recipeSchema = z.strictObject({
  height: z.int().positive(),
  prompt: z.string().min(1),
  seed: z.int().nonnegative(),
  width: z.int().positive(),
});

/**
 * A scalar-only workflow, as the character generation's will be: a prompt and a seed in, one
 * image out, nothing uploaded. It exists in this test only, registered beside the app's own.
 */
const imageDefinition: WorkflowDefinition<
  { prompt: string; seed?: number },
  z.output<typeof recipeSchema>
> = {
  assetInputs: () => ({}),
  buildGraph: (recipe) => buildGraph(template, inputsMap, recipe),
  id: "test-image",
  inputSchema: z.object({ prompt: z.string().min(1), seed: z.int().optional() }),
  models: [],
  outputs: [{ media: "image", name: "image", nodeId: "9" }],
  prepareRecipe: ({ prompt, seed }) => ({
    recipe: { height: 832, prompt, seed: seed ?? 7, width: 512 },
  }),
  rebase: (recipe, { seed }) => ({ ...recipe, seed }),
  recipeSchema,
  seedOf: (recipe) => recipe.seed,
  version: 1,
  workflowHash: "0".repeat(64),
};

workflows.register(imageDefinition);

const session = { codeId: findAccessCode(mintCode(100))?.id ?? "" };
const scope = { free: () => false, session };

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

test("a scalar-only workflow runs submit → done through the fake provider: no upload, one image output", async () => {
  const before = { ...fakeProvider.calls };

  const { id, reused } = await submit(
    imageDefinition,
    { prompt: "A portrait", seed: 1 },
    { scope },
  );

  const queued = findGeneration(id);

  assert.equal(reused, false);
  assert.equal(queued?.status, "queued");
  assert.equal(queued?.provider_inputs, null);
  assert.ok(queued?.submit_started_at);
  assert.deepEqual(queued?.recipe, { height: 832, prompt: "A portrait", seed: 1, width: 512 });
  assert.deepEqual(
    [fakeProvider.calls.upload - before.upload, fakeProvider.calls.submit - before.submit],
    [0, 1],
  );

  const done = await readGeneration(id);

  assert.equal(done?.status, "done");
  assert.deepEqual([done?.final_asset_id, done?.poster_asset_id], [null, null]);

  const outputs = readOutputs(id);
  const image = findAsset(outputs[0]?.asset.id ?? "");

  assert.deepEqual(
    outputs.map(({ media, name }) => ({ media, name })),
    [{ media: "image", name: "image" }],
  );
  assert.equal(image?.sha256, await sha256("tests/fixtures/fake-output.png"));
  assert.deepEqual(
    [image?.kind, image?.role, image?.mime, image?.duration_ms, image?.source_asset_id],
    ["image", "provider_output", "image/png", null, null],
  );
  assert.ok(image?.width && image.height);

  // Its pages show it by its outputs, and its share page opens it to anyone.
  const result = readGenerationResult(id);
  const share = readGenerationShare(done?.share_slug ?? "", "https://photon.example");

  assert.deepEqual(result?.outputs, outputs);
  assert.deepEqual(result?.workflow, { id: "test-image", version: 1 });
  assert.equal(share?.outputs[0]?.url, `https://photon.example/media/${image?.id}.png`);
  assert.equal(isPublicRequest("GET", `/media/${image?.id}.png`), true);

  // The same input is the same recipe: its result comes back, nothing is sent.
  assert.deepEqual(await submit(imageDefinition, { prompt: "A portrait", seed: 1 }, { scope }), {
    id,
    reused: true,
  });
  assert.equal(fakeProvider.calls.submit - before.submit, 1);
});

test("a provider_failed job fails the row with provider_failed", async () => {
  const { id } = await submit(
    imageDefinition,
    { prompt: "[fake:provider_failed] A portrait" },
    {
      scope,
    },
  );

  const failed = await readGeneration(id);

  assert.deepEqual([failed?.status, failed?.error_code], ["failed", "provider_failed"]);
  assert.deepEqual(readOutputs(id), []);
});

test("an ambiguous submit leaves the row unknown after exactly one submit, and never resubmits it", async () => {
  const before = fakeProvider.calls.submit;
  const same = { prompt: "[fake:ambiguous] A portrait" };
  const { id } = await submit(imageDefinition, same, { scope });

  assert.equal(findGeneration(id)?.status, "unknown");
  assert.equal(findGeneration(id)?.provider_job_id, null);
  assert.equal(fakeProvider.calls.submit - before, 1);

  // The same recipe again returns the unknown row; nothing is sent.
  assert.deepEqual(await submit(imageDefinition, same, { scope }), { id, reused: true });
  assert.equal((await readGeneration(id))?.status, "unknown");
  assert.equal(fakeProvider.calls.submit - before, 1);
});

test("a scalar-only row a stopped server left mid-submit is unknown, though it uploaded nothing", async () => {
  const row = (seed: number) =>
    createGeneration(imageDefinition, {
      recipe: { height: 832, prompt: "Left behind", seed, width: 512 },
      target: providerTarget(),
    });

  // Stopped before the graph went out: nothing was sent.
  const beforeSubmit = row(100);

  assert.deepEqual(
    [(await readGeneration(beforeSubmit.id))?.status, beforeSubmit.provider_inputs],
    ["failed", null],
  );

  // Stopped while the provider was being asked: the job may exist there.
  const midSubmit = row(101);

  markSubmitting(midSubmit.id);

  assert.equal((await readGeneration(midSubmit.id))?.status, "unknown");
});

test("a job submitted to another endpoint is never asked about: the row stays as it is", async () => {
  const { id } = await submit(imageDefinition, { prompt: "Elsewhere", seed: 200 }, { scope });

  // As if the server's COMFY_BASE_URL had pointed at another proxy when the job was submitted.
  database
    .prepare("UPDATE generations SET target_origin = 'http://10.0.0.2:8188' WHERE id = ?")
    .run(id);

  const before = fakeProvider.calls.job;
  const read = await readGeneration(id);

  assert.deepEqual([read?.status, fakeProvider.calls.job - before], ["queued", 0]);

  // Back on the endpoint it was submitted to, it finishes as usual.
  database
    .prepare("UPDATE generations SET target_origin = ? WHERE id = ?")
    .run(providerTarget().origin, id);

  assert.equal((await readGeneration(id))?.status, "done");
});
