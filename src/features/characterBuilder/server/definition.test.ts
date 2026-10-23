import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { z } from "zod";

import type { ProviderTarget } from "../../../shared/server/comfy-target.ts";
import { hashRecipe } from "../../../shared/server/generation/generations.ts";
import { readModelsLock } from "../../../shared/server/models-lock.ts";
import { workflowGraphSchema } from "../../../shared/server/workflow-graph.ts";
import {
  characterCaptionInputSchema,
  characterGenerationInputSchema,
  compileCharacterRequest,
} from "../contracts.ts";
import { characterCaptionDefinition as caption } from "../workflows/caption-definition.ts";
import { characterGenerationDefinition as image } from "../workflows/definition.ts";

const WORKFLOWS = "src/features/characterBuilder/workflows";
const imageBytes = readFileSync(`${WORKFLOWS}/character-generation.v1.json`);
const captionBytes = readFileSync(`${WORKFLOWS}/character-caption.v1.json`);
const imageTemplate = workflowGraphSchema.parse(JSON.parse(imageBytes.toString("utf8")));
const captionTemplate = workflowGraphSchema.parse(JSON.parse(captionBytes.toString("utf8")));
const lock = readModelsLock(`${WORKFLOWS}/models.lock`);
const cloud: ProviderTarget = { kind: "cloud", origin: null };
const selfhost: ProviderTarget = { kind: "selfhost", origin: null };
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** The recipe a definition prepares for a request body, parsed (and trimmed) as its route does. */
function prepareImage(body: z.input<typeof characterGenerationInputSchema>, target = cloud) {
  return image.prepareRecipe(characterGenerationInputSchema.parse(body), { target }).recipe;
}

function prepareCaption(body: z.input<typeof characterCaptionInputSchema>, target = cloud) {
  return caption.prepareRecipe(characterCaptionInputSchema.parse(body), { target }).recipe;
}

/** Every `node.field` of `graph` with its value, as JSON. */
function fields(graph: typeof imageTemplate) {
  return new Map(
    Object.entries(graph).flatMap(([id, node]) =>
      Object.entries(node.inputs).map(([field, value]) => [
        `${id}.${field}`,
        JSON.stringify(value),
      ]),
    ),
  );
}

/** The `[node.field, value]` pairs of `graph` that differ from `template`. */
function changed(template: typeof imageTemplate, graph: typeof imageTemplate) {
  const before = fields(template);

  return new Set([...fields(graph)].filter(([path, value]) => before.get(path) !== value));
}

const pin = (file: string) => {
  const model = lock.models.find((entry) => entry.file === file);

  assert.ok(model, `${file} is locked`);

  return { file, license: model.license, sha256: model.sha256 };
};

test("a caption request becomes a recipe with the compiled request, the upsampler and the workflow's identity", () => {
  const controls = { appearance: " Red curly hair ", outfit: "", style: "anime" as const };
  const recipe = prepareCaption({ controls, description: "  A street musician ", seed: 3 });
  const system = captionTemplate["18:14"]?.inputs.value;

  assert.deepEqual(recipe, {
    controls: { appearance: "Red curly hair", style: "anime" },
    description: "A street musician",
    models: [pin("qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors")],
    request: compileCharacterRequest("A street musician", {
      appearance: "Red curly hair",
      style: "anime",
    }),
    seed: 3,
    target: "cloud",
    upsampler: {
      model: "qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors",
      settings: {
        max_length: 3584,
        min_p: 0,
        mtp: "off",
        presence_penalty: 1.5,
        repetition_penalty: 1.05,
        sampling_mode: "on",
        temperature: 1,
        thinking: false,
        top_k: 1,
        top_p: 0.95,
        use_default_template: true,
      },
      system_prompt: system,
    },
    workflow: { id: "character-caption", sha256: sha256(captionBytes), version: 1 },
  });
  assert.match(
    z.string().parse(system),
    /^You are the prompt upsampler of a text-to-image model\./,
  );
  assert.equal(caption.workflowHash, recipe.workflow.sha256);
  assert.deepEqual(caption.models, recipe.models);
  assert.equal(caption.promptOf?.(recipe), recipe.request);
  assert.deepEqual(caption.assetInputs(recipe), {});

  // No controls, or only blank ones, are stored as none.
  assert.equal(prepareCaption({ description: "x", seed: 1 }).controls, null);
  assert.equal(
    prepareCaption({ controls: { outfit: "  " }, description: "x", seed: 1 }).controls,
    null,
  );
});

test("the caption graph binds the request and the upsampler seed only and ends in SaveText", () => {
  const recipe = prepareCaption({ description: "A knight", seed: 77 });
  const graph = caption.buildGraph(recipe, {});

  assert.deepEqual(
    changed(captionTemplate, graph),
    new Set([
      ["18:11.prompt", JSON.stringify(recipe.request)],
      ["18:11.sampling_mode.seed", "77"],
    ]),
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(captionTemplate).map(([id, node]) => [id, node.class_type])),
    {
      "18:11": "TextGenerate",
      "18:12": "CLIPLoader",
      "18:13": "SaveText",
      "18:14": "PrimitiveStringMultiline",
    },
  );
  assert.deepEqual(captionTemplate["18:13"]?.inputs, {
    filename_prefix: "character_caption",
    format: "txt",
    text: ["18:11", 0],
  });
  assert.equal(captionTemplate["18:12"]?.inputs.type, "flux3");
  assert.deepEqual(caption.outputs, [{ media: "text", name: "caption", nodeId: "18:13" }]);
});

test("an image request without an enhancement keeps the client's provenance and the caption byte for byte", () => {
  const text = "  A knight in silver armour,\n\tfull body — «ünïcode» ✓  ";

  const recipe = prepareImage({
    caption: text,
    seed: 5,
    source: { controls: { style: "realistic" }, description: " A knight " },
  });

  assert.deepEqual(recipe, {
    caption: text,
    height: 1344,
    models: [
      pin("flux3-image-klein-int8-convrot.safetensors"),
      pin("qwen3vl_4b_int8_convrot.safetensors"),
      pin("flux2-vae.safetensors"),
    ],
    seed: 5,
    source: { controls: { style: "realistic" }, description: "A knight", enhancement: null },
    target: "cloud",
    width: 768,
    workflow: { id: "character-generation", sha256: sha256(imageBytes), version: 1 },
  });
  assert.equal(image.workflowHash, recipe.workflow.sha256);
  assert.deepEqual(image.models, recipe.models);
  assert.equal(image.promptOf?.(recipe), text);
  assert.equal(image.buildGraph(recipe, {})["18:4"]?.inputs.text, text);
  assert.deepEqual(prepareImage({ caption: "x", seed: 1 }).source, {
    controls: null,
    description: null,
    enhancement: null,
  });
  assert.deepEqual(
    [prepareImage({ caption: "x", seed: 1 }, selfhost).target, image.assetInputs(recipe)],
    ["selfhost", {}],
  );
});

test("the same image request is the same recipe hash through a stored round trip; another caption, seed or size is not", () => {
  const body = { caption: "A knight", seed: 5 };
  const recipe = prepareImage(body);
  const { hash } = hashRecipe(image, recipe);
  const stored = image.recipeSchema.parse(JSON.parse(JSON.stringify(recipe)));

  assert.deepEqual(stored, recipe);
  assert.equal(hashRecipe(image, stored).hash, hash);
  assert.equal(hashRecipe(image, prepareImage({ ...body, height: 1344, width: 768 })).hash, hash);

  for (const other of [
    { caption: "A knight ", seed: 5 },
    { caption: "A knight", seed: 6 },
    { caption: "A knight", seed: 5, width: 832 },
    { caption: "A knight", seed: 5, source: { description: "x" } },
  ]) {
    assert.notEqual(hashRecipe(image, prepareImage(other)).hash, hash);
  }

  assert.notEqual(hashRecipe(image, { ...recipe, target: "selfhost" }).hash, hash);
  assert.throws(() => image.recipeSchema.parse({ ...recipe, prompt: "x" }));
});

test("a request without a seed gets a random one, resolved once into its recipe", () => {
  const recipe = prepareImage({ caption: "A knight" });

  assert.ok(Number.isSafeInteger(recipe.seed) && recipe.seed >= 0);
  assert.equal(image.seedOf(recipe), recipe.seed);
  assert.equal(image.buildGraph(recipe, {})["18:7"]?.inputs.seed, recipe.seed);

  const seeds = new Set(Array.from({ length: 8 }, () => prepareImage({ caption: "x" }).seed));

  assert.ok(seeds.size > 1, "eight blank-seed requests drew one seed");
  assert.ok(Number.isSafeInteger(prepareCaption({ description: "x" }).seed));
});

test("the input schemas refuse blank or long captions and descriptions and sizes FLUX cannot latent", () => {
  for (const body of [
    {},
    { caption: "" },
    { caption: " \n\t " },
    { caption: "x".repeat(4001) },
    { caption: "x", seed: 1.5 },
    { caption: "x", seed: -1 },
    { caption: "x", width: 770 },
    { caption: "x", height: 496 },
    { caption: "x", height: 2064 },
    { caption: "x", source: { caption_generation_id: "not-a-uuid" } },
    { caption: "x", source: { description: "x".repeat(1001) } },
  ]) {
    assert.equal(image.inputSchema.safeParse(body).success, false, JSON.stringify(body));
  }

  assert.equal(image.inputSchema.safeParse({ caption: "x".repeat(4000) }).success, true);

  for (const body of [
    {},
    { description: "  " },
    { description: "x".repeat(1001) },
    { controls: { style: "oil" }, description: "x" },
    { controls: { outfit: "x".repeat(201) }, description: "x" },
  ]) {
    assert.equal(caption.inputSchema.safeParse(body).success, false, JSON.stringify(body));
  }
});

test("the image graph binds caption, seed and size to literal fields and never runs the upsampler", () => {
  const recipe = prepareImage({ caption: "A knight", height: 1216, seed: 42, width: 832 });
  const snapshot = structuredClone(imageTemplate);
  const graph = image.buildGraph(recipe, {});

  assert.deepEqual(
    changed(imageTemplate, graph),
    new Set([
      ["18:4.text", JSON.stringify("A knight")],
      ["18:7.seed", "42"],
      ["18:6.width", "832"],
      ["18:6.height", "1216"],
    ]),
  );
  assert.deepEqual(imageTemplate, snapshot);
  assert.deepEqual(
    [...new Set(Object.values(imageTemplate).map(({ class_type }) => class_type))].sort(),
    [
      "CLIPLoader",
      "CLIPTextEncode",
      "EmptyFlux2LatentImage",
      "KSampler",
      "SaveImage",
      "UNETLoader",
      "VAEDecode",
      "VAELoader",
    ],
  );
  // The distilled checkpoint's defaults (Comfy's template, BFL's card): 16 steps, no guidance.
  assert.deepEqual(imageTemplate["18:7"]?.inputs, {
    cfg: 1,
    denoise: 1,
    latent_image: ["18:6", 0],
    model: ["18:1", 0],
    negative: ["18:5", 0],
    positive: ["18:4", 0],
    sampler_name: "euler",
    scheduler: "simple",
    seed: imageTemplate["18:7"]?.inputs.seed,
    steps: 16,
  });
  assert.equal(imageTemplate["18:2"]?.inputs.type, "flux3");
  assert.equal(imageTemplate["18:5"]?.inputs.text, "");
  assert.deepEqual(image.outputs, [{ media: "image", name: "image", nodeId: "9" }]);
  assert.deepEqual(graph["9"]?.inputs.images, ["18:8", 0]);
});

test("a re-run or retry keeps the caption and its source but the seed and target; another workflow file's recipe is refused", () => {
  const recipe = prepareImage({ caption: "A knight", seed: 5, source: { description: "x" } });

  assert.deepEqual(image.rebase(recipe, { seed: 9, target: selfhost }), {
    ...recipe,
    seed: 9,
    target: "selfhost",
  });
  assert.equal(
    image.rebase(
      { ...recipe, workflow: { ...recipe.workflow, sha256: "0".repeat(64) } },
      { seed: 9, target: cloud },
    ),
    null,
  );

  const enhanced = prepareCaption({ description: "A knight", seed: 5 });

  assert.deepEqual(caption.rebase(enhanced, { seed: 8, target: cloud }), { ...enhanced, seed: 8 });
});

test("the lock pins FLUX 3 from Black Forest Labs' repository at one commit, with the FLUX Kommunity licence on the transformer", () => {
  assert.deepEqual(
    lock.models.map(({ file, license }) => [file, license]),
    [
      ["flux3-image-klein-int8-convrot.safetensors", "FLUX-Kommunity-1.0"],
      ["qwen3vl_4b_int8_convrot.safetensors", "Apache-2.0"],
      ["qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors", "Apache-2.0"],
      ["flux2-vae.safetensors", "Apache-2.0"],
    ],
  );
  assert.ok(
    lock.models
      .filter(({ file }) => file !== "flux2-vae.safetensors")
      .every(({ url }) =>
        url.startsWith(
          "https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/feef60b0aaf63a4773ace96636ebbcf43b881312/",
        ),
      ),
  );
});
