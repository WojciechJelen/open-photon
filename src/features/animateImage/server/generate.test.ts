import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { copyFile } from "node:fs/promises";
import test from "node:test";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { generationReceiptSchema } from "../../../shared/contracts.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { hashFile, incomingPath, storeAsset } from "../../../shared/server/assets.ts";
import { fakeProvider } from "../../../shared/server/comfy-provider.fake.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import {
  recipeIdentitySchema,
  type WorkflowDefinition,
  workflows,
} from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findGeneration, readOutputs } from "../../../shared/server/generation/generations.ts";
import { readGenerationResult } from "../../../shared/server/generation/pages.ts";
import type { Json } from "../../../shared/server/generation/recipe-hash.ts";
import { readGeneration, retry, submit } from "../../../shared/server/generation/service.ts";
import { workflowGraphSchema, type WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import { createFromUpload, listSampleCharacters } from "../../characters/api.ts";
import type { AnimateImageInput } from "../contracts.ts";
import { animateImageDefinition } from "../workflows/definition.ts";
import { animateImage, handleAnimation } from "./generate.ts";

// `comfyProvider` (the default of every call below) is the fake: a self-hosted dead port, so
// nothing could reach a real Comfy.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

// Every answer below but a reused result takes a token; the default (3 a minute) would refuse.
process.env.GENERATE_RATE_LIMIT = "1000";

const code = mintCode(1000);
const session = { codeId: findAccessCode(code)?.id ?? "" };
const guard = createAccessGuard({ production: true });

const cookie =
  (
    await guard(
      new Request("http://localhost/api/session", {
        body: JSON.stringify({ code }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    )
  )?.headers
    .get("Set-Cookie")
    ?.split(";")[0] ?? "";

/** `POST /api/animations` with `body` as JSON, with the session cookie or without. */
function post(body: Json, withSession = true) {
  return new Request("http://localhost/api/animations", {
    body: JSON.stringify(body),
    headers: { "X-Client": "animate-image-test", ...(withSession && { Cookie: cookie }) },
    method: "POST",
  });
}

/** The fake provider, keeping every graph it is sent. */
function recording() {
  const graphs: WorkflowGraph[] = [];

  const provider: Provider = {
    ...fakeProvider,
    submit: (graph, key) => {
      graphs.push(graph);

      return fakeProvider.submit(graph, key);
    },
  };

  return { graphs, provider };
}

// The fake's 128×128 PNG, stored as an uploaded image (`POST /api/image-uploads` stores the same).
const uploaded = await (async () => {
  const temporary = await incomingPath();

  await copyFile("tests/fixtures/fake-output.png", temporary);

  const { asset } = await storeAsset(temporary, {
    bytes: 4043,
    duration_ms: null,
    ext: "png",
    fps: null,
    has_audio: null,
    height: 128,
    kind: "image",
    mime: "image/png",
    role: "upload",
    sha256: await hashFile(temporary),
    source_asset_id: null,
    width: 128,
  });

  return asset;
})();

// A test workflow with one image output (the fake answers `SaveImage` with its PNG), standing
// in for any feature's image generation an animation may start from.
const imageRecipeSchema = recipeIdentitySchema.extend({ prompt: z.string() }).strict();

const imageDefinition: WorkflowDefinition<
  { prompt: string },
  z.output<typeof imageRecipeSchema>
> = {
  assetInputs: () => ({}),
  buildGraph: (recipe) =>
    workflowGraphSchema.parse({
      "9": {
        class_type: "SaveImage",
        inputs: { filename_prefix: recipe.prompt, images: ["8", 0] },
      },
    }),
  id: "test-animate-source",
  inputSchema: z.object({ prompt: z.string() }),
  models: [],
  outputs: [{ media: "image", name: "image", nodeId: "9" }],
  prepareRecipe: ({ prompt }, { target }) => ({
    recipe: {
      models: [],
      prompt,
      target: target.kind,
      workflow: { id: "test-animate-source", sha256: "0".repeat(64), version: 1 },
    },
  }),
  rebase: (recipe, { target }) => ({ ...recipe, target: target.kind }),
  recipeSchema: imageRecipeSchema,
  seedOf: () => 0,
  version: 1,
  workflowHash: "0".repeat(64),
};

workflows.register(imageDefinition);

/** A done generation of the test image workflow. */
async function doneImage(prompt: string) {
  const { id } = await submit(
    imageDefinition,
    { prompt },
    { scope: { free: () => false, session } },
  );

  assert.equal((await readGeneration(id))?.status, "done");

  return id;
}

/** Animates `input`, waits for it to end, and answers its row and the graph the fake got. */
async function animated(input: AnimateImageInput) {
  const { graphs, provider } = recording();
  const { id, reused } = await animateImage(input, session, { provider });
  const generation = await readGeneration(id);
  const row = findGeneration(id);

  assert.equal(reused, false);
  assert.ok(row);

  return {
    generation,
    graph: graphs[0],
    id,
    recipe: animateImageDefinition.recipeSchema.parse(row.recipe),
    row,
  };
}

/** The refusal `start` rejects with, as `{ status, reason }`. */
async function refusal(start: Promise<unknown>) {
  try {
    await start;
  } catch (error) {
    if (error instanceof GenerateError) {
      return { reason: error.reason, status: error.status };
    }

    throw error;
  }

  return assert.fail("expected a GenerateError");
}

test("an uploaded image animates on the fake provider into a private MP4 with its poster", async () => {
  const { generation, graph, id, recipe, row } = await animated({
    prompt: "The cube spins slowly.",
    seed: 7,
    source: { asset_id: uploaded.id, kind: "upload" },
  });

  assert.equal(generation?.status, "done");
  assert.deepEqual(recipe.image, { height: 128, sha256: uploaded.sha256, width: 128 });
  assert.deepEqual(recipe.params, {
    height: 640,
    prompt: "The cube spins slowly.",
    seed: 7,
    width: 640,
  });
  assert.equal(recipe.workflow.id, "animate-image");
  // The graph: the prompt, seed and size bound where the inputs map says, the image uploaded.
  assert.equal(graph?.["4"]?.inputs.text, "The cube spins slowly.");
  assert.equal(graph?.["13"]?.inputs.noise_seed, 7);
  assert.deepEqual([graph?.["6"]?.inputs.width, graph?.["6"]?.inputs.height], [640, 640]);
  assert.equal(typeof graph?.["1"]?.inputs.image, "object");
  assert.deepEqual(
    readOutputs(id)
      .map(({ asset, media, name }) => `${name} ${media} ${asset.mime}`)
      .sort(),
    ["poster poster image/jpeg", "video video video/mp4"],
  );
  // Private until its owner publishes it.
  assert.equal(row.share_slug, null);
  assert.equal(findGeneration(id)?.share_slug, null);
  assert.equal(readGenerationResult(id)?.workflow.id, "animate-image");
});

test("a done generation's image output animates, and the share recipe hides which one it was", async () => {
  const source = await doneImage(`a lighthouse ${crypto.randomUUID()}`);

  const { generation, recipe, row } = await animated({
    prompt: "Waves crash against the rocks.",
    source: { generation_id: source, kind: "generation", output: "image" },
  });

  assert.equal(generation?.status, "done");
  assert.deepEqual(recipe.source, { generation_id: source, kind: "generation", output: "image" });
  assert.equal(recipe.image.sha256, readOutputs(source)[0]?.asset.sha256);
  // A seed was drawn once into the recipe.
  assert.ok(Number.isInteger(recipe.params.seed));
  assert.equal(row.character_id, null);
  assert.deepEqual(animateImageDefinition.shareRecipe?.(recipe), {
    ...recipe,
    source: { kind: "generation" },
  });
});

test("a library character animates from its reference image and is linked to the generation", async () => {
  const [sample] = listSampleCharacters();

  assert.ok(sample);

  const { generation, recipe, row } = await animated({
    prompt: "She waves at the camera.",
    seed: 3,
    source: { character_id: sample.id, kind: "character" },
  });

  assert.equal(generation?.status, "done");
  assert.equal(recipe.image.sha256, sample.image.sha256);
  // The 768×1344 samples animate at 480×848 (9:16).
  assert.deepEqual([recipe.params.width, recipe.params.height], [480, 848]);
  assert.equal(row.character_id, sample.id);
});

test("sources it cannot animate are refused before anything is stored or sent", async () => {
  const pending = await submit(
    imageDefinition,
    { prompt: `[fake:provider_failed] ${crypto.randomUUID()}` },
    { scope: { free: () => false, session } },
  );

  const animation = await animated({
    prompt: "A take to animate again.",
    seed: 1,
    source: { asset_id: uploaded.id, kind: "upload" },
  });

  const done = await doneImage(`a pier ${crypto.randomUUID()}`);
  const { graphs, provider } = recording();

  const refused = (source: AnimateImageInput["source"]) =>
    refusal(animateImage({ prompt: "Move.", seed: 1, source }, session, { provider }));

  assert.deepEqual(await refused({ asset_id: crypto.randomUUID(), kind: "upload" }), {
    reason: "source_not_found",
    status: 404,
  });
  assert.deepEqual(
    await refused({ generation_id: crypto.randomUUID(), kind: "generation", output: "image" }),
    { reason: "source_not_found", status: 404 },
  );
  assert.equal((await readGeneration(pending.id))?.status, "failed");
  assert.deepEqual(
    await refused({ generation_id: pending.id, kind: "generation", output: "image" }),
    { reason: "source_not_done", status: 409 },
  );
  // A video is no image; nor is an output the generation does not have.
  assert.deepEqual(
    await refused({ generation_id: animation.id, kind: "generation", output: "video" }),
    { reason: "source_not_image", status: 422 },
  );
  assert.deepEqual(await refused({ generation_id: done, kind: "generation", output: "image-2" }), {
    reason: "source_not_image",
    status: 422,
  });
  assert.deepEqual(await refused({ character_id: crypto.randomUUID(), kind: "character" }), {
    reason: "source_not_found",
    status: 404,
  });
  assert.equal(graphs.length, 0);
});

test("an uploaded likeness saved with consent animates as a library character", async () => {
  const { character } = createFromUpload({
    assetId: uploaded.id,
    consentAt: new Date().toISOString(),
  });

  const { generation } = await animated({
    prompt: "He nods.",
    seed: 5,
    source: { character_id: character.id, kind: "character" },
  });

  assert.equal(generation?.status, "done");
});

test("a render Comfy fails is failed provider_failed, and retry renders it again with a new seed", async () => {
  const { generation, id, recipe } = await animated({
    prompt: "[fake:provider_failed] The dog jumps.",
    seed: 11,
    source: { asset_id: uploaded.id, kind: "upload" },
  });

  assert.deepEqual([generation?.status, generation?.error_code], ["failed", "provider_failed"]);
  assert.deepEqual(readOutputs(id), []);

  // The marker stays in the prompt, so the retry fails the same way; what matters is that the
  // shared retry takes it, as a child with the same source and prompt and a new seed.
  const child = await retry(id, session);
  const childRow = findGeneration(child.id);
  const childRecipe = animateImageDefinition.recipeSchema.parse(childRow?.recipe);

  assert.equal(childRow?.parent_id, id);
  assert.deepEqual(childRecipe.source, recipe.source);
  assert.equal(childRecipe.params.prompt, recipe.params.prompt);
  assert.notEqual(childRecipe.params.seed, recipe.params.seed);
});

test("POST /api/animations: 401 without a session, 400 for a bad body, request_key returns the first answer", async () => {
  assert.equal(
    (
      await guard(
        post({ prompt: "Move.", source: { asset_id: uploaded.id, kind: "upload" } }, false),
      )
    )?.status,
    401,
  );

  const bad = await handleAnimation(post({ prompt: "  ", source: { kind: "upload" } }));

  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).reason, "invalid_input");

  // No seed: each request would draw its own, so only the key makes the repeat the same take.
  const body = {
    prompt: `The leaves rustle ${crypto.randomUUID()}.`,
    request_key: crypto.randomUUID(),
    source: { asset_id: uploaded.id, kind: "upload" },
  };

  const first = await handleAnimation(post(body));
  const again = await handleAnimation(post(body));
  const receipt = generationReceiptSchema.parse(await first.json());

  // The repeat is the first answer again, under the same key: one generation.
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  assert.deepEqual(generationReceiptSchema.parse(await again.json()), receipt);

  const missing = await handleAnimation(
    post({ prompt: "Move.", source: { asset_id: crypto.randomUUID(), kind: "upload" } }),
  );

  assert.deepEqual([missing.status, (await missing.json()).reason], [404, "source_not_found"]);
});
