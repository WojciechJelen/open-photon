import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { findAsset, incomingPath, storeAsset } from "../../../shared/server/assets.ts";
import { fakeProvider } from "../../../shared/server/comfy-provider.fake.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { workflows } from "../../../shared/server/generation/definition.ts";
import { startDispatcher } from "../../../shared/server/generation/dispatcher.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import {
  findGeneration,
  isSharedOutput,
  publishGeneration,
  readOutputs,
  snapshot,
} from "../../../shared/server/generation/generations.ts";
import { readGenerationShare } from "../../../shared/server/generation/pages.ts";
import {
  readGeneration,
  rerun,
  retry,
  submit,
  submitMany,
} from "../../../shared/server/generation/service.ts";
import type { WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import { createFromUpload, listSampleCharacters } from "../../characters/api.ts";
import {
  IMAGE_EDIT_CAPTION_OUTPUT as SERVER_CAPTION_OUTPUT,
  IMAGE_EDIT_OUTPUT as SERVER_IMAGE_OUTPUT,
  imageEditDefinition,
  imageEditDefinitionFor,
  imageEditEnhancedDefinition,
  type ImageEditInput,
  imageEditInputSchema as serverInputSchema,
} from "../api.ts";
import {
  IMAGE_EDIT_CAPTION_OUTPUT,
  IMAGE_EDIT_MAX_REFERENCES,
  IMAGE_EDIT_OUTPUT,
  IMAGE_EDIT_PIXELS,
  IMAGE_EDIT_SIDE,
  imageEditInputSchema,
  type ImageEditReference,
} from "../index.ts";

// `comfyProvider` (the default of every call below) is the fake: a self-hosted dead port, so
// nothing could reach a real Comfy.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

process.env.GENERATE_RATE_LIMIT = "1000";

const session = { codeId: findAccessCode(mintCode(1000))?.id ?? "" };
const scope = { free: () => false, session };
const fixtureCaption = await readFile("tests/fixtures/fake-output.txt", "utf8");

/** A stored asset of `kind` with its own bytes (the fake provider never reads them as an image). */
async function storedAsset(width: number, height: number, kind: "image" | "video" = "image") {
  const bytes = randomBytes(64);
  const temporary = await incomingPath();

  await writeFile(temporary, bytes);

  const { asset } = await storeAsset(temporary, {
    bytes: bytes.length,
    duration_ms: kind === "video" ? 3000 : null,
    ext: kind === "video" ? "mp4" : "png",
    fps: null,
    has_audio: null,
    height,
    kind,
    mime: kind === "video" ? "video/mp4" : "image/png",
    role: "upload",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source_asset_id: null,
    width,
  });

  return asset;
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

function generationCount() {
  return z
    .object({ count: z.int() })
    .parse(database.prepare("SELECT count(*) AS count FROM generations").get()).count;
}

const recipeSchema = imageEditDefinition.recipeSchema;

function recipeOf(id: string) {
  const row = findGeneration(id);

  return row?.workflow_id === imageEditEnhancedDefinition.id
    ? imageEditEnhancedDefinition.recipeSchema.parse(row.recipe)
    : recipeSchema.parse(row?.recipe);
}

/** An edit input, parsed as a consumer's route would parse its body. */
function input(value: z.input<typeof imageEditInputSchema>) {
  return imageEditInputSchema.parse(value);
}

test("the server and client modules export one contract", () => {
  assert.equal(serverInputSchema, imageEditInputSchema);
  assert.deepEqual(
    [SERVER_IMAGE_OUTPUT, SERVER_CAPTION_OUTPUT, IMAGE_EDIT_OUTPUT, IMAGE_EDIT_CAPTION_OUTPUT],
    ["image", "caption", "image", "caption"],
  );
  assert.deepEqual([imageEditDefinition.id, imageEditDefinition.version], ["image-edit", 1]);
  assert.deepEqual(
    [imageEditEnhancedDefinition.id, imageEditEnhancedDefinition.version],
    ["image-edit-enhanced", 1],
  );
  assert.equal(imageEditDefinitionFor({}), imageEditDefinition);
  assert.equal(imageEditDefinitionFor({ enhance: false }), imageEditDefinition);
  assert.equal(imageEditDefinitionFor({ enhance: true }), imageEditEnhancedDefinition);
  // Both are composed (`src/app/server.ts`), so a stored edit finds its definition again.
  assert.equal(
    workflows.find({ workflow_id: "image-edit", workflow_version: 1 }),
    imageEditDefinition,
  );
  assert.equal(
    workflows.find({ workflow_id: "image-edit-enhanced", workflow_version: 1 }),
    imageEditEnhancedDefinition,
  );
  // The direct graph loads three model files, the enhanced one the upsampler too.
  assert.deepEqual(
    new Set(imageEditDefinition.models.map(({ file }) => file)),
    new Set([
      "flux2-vae.safetensors",
      "flux3-image-klein-int8-convrot.safetensors",
      "qwen3vl_4b_int8_convrot.safetensors",
    ]),
  );
  assert.deepEqual(
    new Set(imageEditEnhancedDefinition.models.map(({ file }) => file)),
    new Set([
      "flux2-vae.safetensors",
      "flux3-image-klein-int8-convrot.safetensors",
      "qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors",
      "qwen3vl_4b_int8_convrot.safetensors",
    ]),
  );
});

test("an edit of one image runs on the fake provider into one private image that its owner may publish", async () => {
  const reference = await storedAsset(768, 1344);
  const { graphs, provider } = recording();

  const edit = input({
    origin: { feature: "photoshoot", shoot_id: "s-1" },
    prompt: "  Place her on a sunny street. Keep her face the same.  ",
    references: [{ asset_id: reference.id }],
    seed: 7,
  });

  const { id, reused } = await submit(imageEditDefinitionFor(edit), edit, { provider, scope });
  const recipe = recipeOf(id);

  assert.equal(reused, false);
  assert.deepEqual(
    {
      height: recipe.height,
      origin: recipe.origin,
      prompt: recipe.prompt,
      references: recipe.references,
      seed: recipe.seed,
      width: recipe.width,
    },
    {
      // The first reference's own aspect at about 1 MP.
      height: 1344,
      origin: { feature: "photoshoot", shoot_id: "s-1" },
      prompt: "Place her on a sunny street. Keep her face the same.",
      references: [{ character_id: null, height: 1344, sha256: reference.sha256, width: 768 }],
      seed: 7,
      width: 768,
    },
  );
  assert.equal(imageEditDefinition.promptOf?.(recipe), recipe.prompt);

  const [graph] = graphs;

  assert.equal(graph?.["4"]?.inputs.text, recipe.prompt);
  assert.equal(graph?.["7"]?.inputs.seed, 7);
  assert.deepEqual(graph?.["7"]?.inputs.latent_image, ["44", 0]);
  assert.deepEqual([graph?.["44"]?.inputs.width, graph?.["44"]?.inputs.height], [768, 1344]);

  const done = await readGeneration(id, provider);

  assert.equal(done?.status, "done");
  assert.deepEqual(
    done?.outputs.map(({ media, name }) => [name, media]),
    [["image", "image"]],
  );

  // Private until published (FLUX Kommunity: reviewed before it is distributed).
  const stored = findAsset(readOutputs(id)[0]?.asset.id ?? "");

  assert.equal(done?.share_slug, null);
  assert.ok(stored);
  assert.equal(isSharedOutput(stored), false);

  const slug = publishGeneration(id);
  const share = readGenerationShare(slug, "http://localhost");

  assert.equal(isSharedOutput(stored), true);
  // The share page shows only which feature asked for the edit.
  assert.deepEqual(z.object({ origin: z.json() }).loose().parse(share?.recipe).origin, {
    feature: "photoshoot",
  });

  // The same edit again is the same recipe: its result comes back and nothing is sent.
  assert.deepEqual(await submit(imageEditDefinition, edit, { provider, scope }), {
    id,
    reused: true,
  });
  assert.equal(graphs.length, 1);
});

test("an enhanced edit stores the image and the upsampled prompt as a private text output", async () => {
  const reference = await storedAsset(1344, 768);
  const { graphs, provider } = recording();

  const edit = input({
    enhance: true,
    prompt: "Make him walk along a rainy sidewalk.",
    references: [{ asset_id: reference.id }],
    seed: 21,
  });

  const definition = imageEditDefinitionFor(edit);
  const { id } = await submit(definition, edit, { provider, scope });
  const recipe = recipeOf(id);
  const [graph] = graphs;

  assert.equal(definition, imageEditEnhancedDefinition);
  assert.deepEqual([recipe.width, recipe.height], [1344, 768]);
  assert.equal(graph?.["47"]?.inputs.prompt, "Make him walk along a rainy sidewalk.");
  assert.deepEqual(
    [graph?.["7"]?.inputs.seed, graph?.["47"]?.inputs["sampling_mode.seed"]],
    [21, 21],
  );
  assert.deepEqual(graph?.["4"]?.inputs.text, ["47", 0]);
  assert.equal(graph?.["53"]?.class_type, "SaveText");

  const done = await readGeneration(id, provider);
  const row = findGeneration(id);

  assert.equal(done?.status, "done");
  assert.deepEqual(row && snapshot(row).outputs.filter(({ media }) => media === "text"), [
    { media: "text", name: "caption", text: fixtureCaption },
  ]);
  // Only the image is a file output; the caption is never public, and the prompt a saved
  // character keeps is the user's, not the upsampler's.
  assert.deepEqual(
    readOutputs(id).map(({ name }) => name),
    ["image"],
  );
  assert.equal(imageEditEnhancedDefinition.promptOf?.(recipe), recipe.prompt);

  const share = readGenerationShare(publishGeneration(id), "http://localhost");

  assert.doesNotMatch(JSON.stringify(share), new RegExp(fixtureCaption.trim().slice(0, 40)));
});

test("one, two and three references bind as many LoadImage nodes, in order; the rest are left out", async () => {
  const assets = await Promise.all([
    storedAsset(1024, 1024),
    storedAsset(768, 1344),
    storedAsset(1344, 768),
  ]);

  const references = assets.map(({ id }) => ({ asset_id: id }));

  // What the provider's upload answers for `reference_<n>`.
  const uploaded = (index: number) => ({
    __type: "core/ASSET" as const,
    info: { id: `upload-${index + 1}` },
  });

  for (const definition of [imageEditDefinition, imageEditEnhancedDefinition]) {
    for (const count of [1, 2, 3]) {
      const { recipe } = definition.prepareRecipe(
        input({
          enhance: definition === imageEditEnhancedDefinition,
          prompt: "Put them together.",
          references: references.slice(0, count),
          seed: 1,
        }),
        { target: { kind: "selfhost", origin: "http://127.0.0.1:1" } },
      );

      const inputs = definition.assetInputs(recipe);

      assert.deepEqual(
        inputs,
        Object.fromEntries(
          assets.slice(0, count).map(({ sha256 }, index) => [`reference_${index + 1}`, sha256]),
        ),
      );

      const graph = definition.buildGraph(
        recipe,
        Object.fromEntries(Object.keys(inputs).map((param, index) => [param, uploaded(index)])),
      );

      const loaders = Object.entries(graph)
        .filter(([, node]) => node.class_type === "LoadImage")
        .map(([nodeId, node]) => [nodeId, node.inputs.image]);

      assert.deepEqual(
        loaders,
        ["11", "12", "13"].slice(0, count).map((nodeId, index) => [nodeId, uploaded(index)]),
      );

      const images = (nodeId: string) =>
        Object.entries(graph[nodeId]?.inputs ?? {}).filter(([field]) =>
          field.startsWith("images."),
        );

      const expected = ["11", "12", "13"]
        .slice(0, count)
        .map((nodeId, index) => [`images.image${index}`, [nodeId, 0]]);

      assert.deepEqual(images("17"), expected);

      if (definition === imageEditEnhancedDefinition) {
        assert.deepEqual(images("50"), expected);
      } else {
        assert.equal(graph["50"], undefined);
      }

      // The first reference (1024×1024) sets the size.
      assert.deepEqual([graph["44"]?.inputs.width, graph["44"]?.inputs.height], [1024, 1024]);
    }
  }
});

test("a library character is a reference by its image; the first one is the generation's character", async () => {
  const [sample] = listSampleCharacters();
  const upload = await storedAsset(832, 1216);

  const { character } = createFromUpload({
    assetId: upload.id,
    consentAt: new Date().toISOString(),
  });

  assert.ok(sample);

  const edit = input({
    prompt: "The two of them on a bench.",
    references: [{ character_id: character.id }, { character_id: sample.id }],
    seed: 3,
  });

  const { id } = await submit(imageEditDefinition, edit, { scope });
  const recipe = recipeOf(id);

  assert.equal(findGeneration(id)?.character_id, character.id);
  assert.deepEqual(recipe.references, [
    { character_id: character.id, height: 1216, sha256: upload.sha256, width: 832 },
    {
      character_id: sample.id,
      height: sample.image.height,
      sha256: sample.image.sha256,
      width: sample.image.width,
    },
  ]);
  assert.equal((await readGeneration(id))?.status, "done");

  // An asset first: no character for the generation.
  const other = await submit(
    imageEditDefinition,
    input({ prompt: "Again.", references: [{ asset_id: upload.id }, { character_id: sample.id }] }),
    { scope },
  );

  assert.equal(findGeneration(other.id)?.character_id, null);
});

test("four edits admitted at once with a request key all render and answer the same key again", async () => {
  const reference = await storedAsset(1024, 1024);
  const requestKey = randomUUID();

  const items = ["front", "left", "right", "back"].map((view) => ({
    origin: { feature: "angles", view },
    prompt: `Show the same person from the ${view}.`,
    references: [{ asset_id: reference.id }],
    seed: 40,
  }));

  const receipts = submitMany(imageEditDefinition, items, { requestKey, scope });

  assert.equal(receipts.length, 4);
  assert.equal(new Set(receipts.map(({ id }) => id)).size, 4);
  assert.ok(receipts.every(({ reused }) => !reused));
  assert.deepEqual(
    receipts.map(({ id }) => findGeneration(id)?.request_key),
    [0, 1, 2, 3].map((index) => `${requestKey}#${index}`),
  );

  // The same request again stores nothing and answers the same generations.
  const before = generationCount();

  assert.deepEqual(
    submitMany(imageEditDefinition, items, { requestKey, scope }).map(({ id }) => id),
    receipts.map(({ id }) => id),
  );
  assert.equal(generationCount(), before);

  const dispatcher = startDispatcher({ intervalMs: 10 });

  try {
    const deadline = Date.now() + 30_000;

    while (!receipts.every(({ id }) => findGeneration(id)?.status === "done")) {
      assert.ok(Date.now() < deadline, "every item to finish");

      await delay(10);
    }
  } finally {
    await dispatcher.stop();
  }

  assert.deepEqual(
    receipts.map(({ id }) => readOutputs(id).map(({ name }) => name)),
    [["image"], ["image"], ["image"], ["image"]],
  );

  // An enhanced item in a direct request is refused, and nothing is stored.
  assert.throws(
    () =>
      submitMany(imageEditDefinition, [items[0], { ...items[1], enhance: true }], {
        requestKey: randomUUID(),
        scope,
      }),
    (error) => error instanceof GenerateError && error.status === 422,
  );
  assert.equal(generationCount(), before);
});

test("a failed edit retries with a new seed and re-runs with its own", async () => {
  const reference = await storedAsset(1024, 1024);

  const { id } = await submit(
    imageEditDefinition,
    input({
      prompt: "A failing edit. [fake:provider_failed]",
      references: [{ asset_id: reference.id }],
      seed: 555,
    }),
    { scope },
  );

  assert.equal((await readGeneration(id))?.status, "failed");

  const retried = await retry(id, session);
  const rerun_ = await rerun(id, session);

  assert.equal(findGeneration(retried.id)?.parent_id, id);
  assert.notEqual(recipeOf(retried.id).seed, 555);
  assert.equal(findGeneration(rerun_.id)?.parent_id, id);
  assert.equal(recipeOf(rerun_.id).seed, 555);
  assert.deepEqual(recipeOf(rerun_.id).references, recipeOf(id).references);
});

test("an edit it cannot render is refused with a 4xx before anything is stored", async () => {
  const reference = await storedAsset(1024, 1024);
  const clip = await storedAsset(480, 848, "video");
  const image = { asset_id: reference.id };
  const before = generationCount();

  // Bodies as a client might send them, so not typed as an edit.
  const refusals: [unknown, number, string][] = [
    [{ prompt: "No reference.", references: [] }, 422, "invalid_input"],
    [{ prompt: "Four.", references: [image, image, image, image] }, 422, "invalid_input"],
    [{ prompt: " ", references: [image] }, 422, "invalid_input"],
    [{ prompt: "Odd size.", references: [image], width: 1000, height: 1008 }, 422, "invalid_input"],
    [{ prompt: "One side.", references: [image], width: 1024 }, 422, "invalid_input"],
    [
      { prompt: "Too large.", references: [image], width: 2048, height: 2048 },
      422,
      "invalid_input",
    ],
    [{ prompt: "Too small.", references: [image], width: 512, height: 512 }, 422, "invalid_input"],
    [
      { prompt: "Both.", references: [{ asset_id: reference.id, character_id: randomUUID() }] },
      422,
      "invalid_input",
    ],
    [{ prompt: "Unknown.", references: [{ asset_id: randomUUID() }] }, 404, "asset_not_found"],
    [
      { prompt: "Unknown.", references: [image, { character_id: randomUUID() }] },
      404,
      "character_not_found",
    ],
    [{ prompt: "A clip.", references: [{ asset_id: clip.id }] }, 422, "not_image"],
    [{ enhance: true, prompt: "Wrong definition.", references: [image] }, 422, "invalid_input"],
  ];

  for (const [edit, status, reason] of refusals) {
    await assert.rejects(
      // SAFETY: `submit` takes what a caller built; `prepareRecipe` parses it again and refuses it.
      submit(imageEditDefinition, edit as ImageEditInput, { scope }),
      (error) => {
        assert.ok(error instanceof GenerateError, JSON.stringify(edit));
        assert.deepEqual([error.status, error.reason], [status, reason], JSON.stringify(edit));

        return true;
      },
    );
  }

  // The schema a consumer's route reads its body with refuses the same shapes.
  assert.equal(imageEditInputSchema.safeParse(refusals[0]?.[0]).success, false);
  assert.equal(generationCount(), before);
});

test("the limits the client module states are the ones the schema applies", () => {
  const references: ImageEditReference[] = Array.from(
    { length: IMAGE_EDIT_MAX_REFERENCES },
    () => ({ asset_id: randomUUID() }),
  );

  const ok = (width: number, height: number) =>
    imageEditInputSchema.safeParse({ height, prompt: "x", references, width }).success;

  assert.equal(ok(IMAGE_EDIT_SIDE.max, IMAGE_EDIT_SIDE.min), true);
  assert.equal(ok(IMAGE_EDIT_SIDE.max + IMAGE_EDIT_SIDE.step, IMAGE_EDIT_SIDE.min), false);
  assert.equal(ok(1024, 512), true);
  assert.equal(1024 * 512, IMAGE_EDIT_PIXELS.min);
  assert.equal(ok(1024, 496), false);
  assert.equal(ok(1280, 1280), true);
  assert.ok(1280 * 1312 > IMAGE_EDIT_PIXELS.max);
  assert.equal(ok(1280, 1312), false);
});
