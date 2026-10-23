import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { type ProviderTarget, providerTarget } from "../../../shared/server/comfy-target.ts";
import { hashRecipe } from "../../../shared/server/generation/generations.ts";
import { readModelsLock } from "../../../shared/server/models-lock.ts";
import { workflowGraphSchema } from "../../../shared/server/workflow-graph.ts";
import type { CharacterGenerationInput } from "../contracts.ts";
import { characterGenerationDefinition as definition } from "../workflows/definition.ts";

const WORKFLOW_FILE = "src/features/characterBuilder/workflows/character-generation.v1.json";
const bytes = readFileSync(WORKFLOW_FILE);
const template = workflowGraphSchema.parse(JSON.parse(bytes.toString("utf8")));
const lock = readModelsLock("src/features/characterBuilder/workflows/models.lock");
const cloud: ProviderTarget = { ...providerTarget(), kind: "cloud" };

/** The recipe `definition` prepares for a request body, parsed (and trimmed) as the route does. */
function prepare(body: CharacterGenerationInput, target = cloud) {
  return definition.prepareRecipe(definition.inputSchema.parse(body), { target }).recipe;
}

/** Every `node.field` of `graph` with its value, as JSON. */
function fields(graph: typeof template) {
  return new Map(
    Object.entries(graph).flatMap(([id, node]) =>
      Object.entries(node.inputs).map(([field, value]) => [
        `${id}.${field}`,
        JSON.stringify(value),
      ]),
    ),
  );
}

test("an input becomes a recipe with the defaults, the workflow's identity and its model pins", () => {
  const recipe = prepare({ prompt: "  A knight in silver armour  ", seed: 5 });

  assert.deepEqual(recipe, {
    models: [
      {
        file: "flux-2-klein-4b.safetensors",
        license: "Apache-2.0",
        sha256: "ec3d4e733a771f61c052fb4856c48b336c55eaf2c65487c2a1faeb9bbda7a343",
      },
      {
        file: "qwen_3_4b.safetensors",
        license: "Apache-2.0",
        sha256: "6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a",
      },
      {
        file: "flux2-vae.safetensors",
        license: "Apache-2.0",
        sha256: "868fe7b343cc8f3a19dbcfcafbc3d5f888802be3f89bd81b65b3621a066ce8f3",
      },
    ],
    params: { height: 1344, prompt: "A knight in silver armour", seed: 5, width: 768 },
    target: "cloud",
    workflow: {
      id: "character-generation",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      version: 1,
    },
  });
  assert.equal(definition.workflowHash, recipe.workflow.sha256);
  assert.deepEqual(definition.models, recipe.models);
  assert.deepEqual(
    lock.models.map(({ url }) => url.split("/").slice(3, 6).join("/")),
    Array(3).fill("Comfy-Org/Flux-2-Klein-4B/resolve"),
  );
  assert.equal(definition.promptOf?.(recipe), "A knight in silver armour");
  assert.deepEqual(definition.assetInputs(recipe), {});

  const selfhosted = prepare(
    { height: 1024, prompt: "x", seed: 1, width: 1024 },
    { ...cloud, kind: "selfhost" },
  );

  assert.deepEqual(
    [selfhosted.target, selfhosted.params],
    ["selfhost", { height: 1024, prompt: "x", seed: 1, width: 1024 }],
  );
});

test("the same input is the same recipe hash, through a stored round trip; another seed or size is not", () => {
  const recipe = prepare({ prompt: "A knight", seed: 5 });
  const { hash } = hashRecipe(definition, recipe);
  const stored = definition.recipeSchema.parse(JSON.parse(JSON.stringify(recipe)));

  assert.deepEqual(stored, recipe);
  assert.equal(hashRecipe(definition, stored).hash, hash);
  assert.equal(hashRecipe(definition, prepare({ prompt: "A knight", seed: 5 })).hash, hash);
  assert.equal(
    hashRecipe(definition, prepare({ height: 1344, prompt: "A knight", seed: 5, width: 768 })).hash,
    hash,
  );

  for (const other of [
    { prompt: "A knight", seed: 6 },
    { prompt: "A knight", seed: 5, width: 832 },
    { prompt: "A knight!", seed: 5 },
  ]) {
    assert.notEqual(hashRecipe(definition, prepare(other)).hash, hash);
  }

  assert.notEqual(hashRecipe(definition, { ...recipe, target: "selfhost" }).hash, hash);
  assert.throws(() => definition.recipeSchema.parse({ ...recipe, angle: "front" }));
});

test("a request without a seed gets a random one, resolved once into its recipe", () => {
  const recipe = prepare({ prompt: "A knight" });
  const { seed } = recipe.params;

  assert.ok(Number.isSafeInteger(seed) && seed >= 0);
  assert.equal(definition.seedOf(recipe), seed);
  assert.deepEqual(definition.buildGraph(recipe, {})["77:73"]?.inputs.noise_seed, seed);
  assert.equal(
    hashRecipe(definition, definition.recipeSchema.parse(structuredClone(recipe))).hash,
    hashRecipe(definition, recipe).hash,
  );

  const seeds = new Set(
    Array.from({ length: 8 }, () => prepare({ prompt: "A knight" }).params.seed),
  );

  assert.ok(seeds.size > 1, "eight blank-seed requests drew one seed");
});

test("the input schema refuses an empty or long prompt, a fractional seed and sizes FLUX.2 cannot latent", () => {
  for (const body of [
    {},
    { prompt: "   " },
    { prompt: "x".repeat(1001) },
    { prompt: "x", seed: 1.5 },
    { prompt: "x", seed: -1 },
    { prompt: "x", width: 770 },
    { height: 496, prompt: "x" },
    { height: 2064, prompt: "x" },
    { image: "a.png", prompt: "x", strict: true, width: 1.5 },
  ]) {
    assert.equal(definition.inputSchema.safeParse(body).success, false, JSON.stringify(body));
  }

  assert.equal(definition.inputSchema.safeParse({ prompt: "x".repeat(1000) }).success, true);
});

test("the graph binds prompt, seed and size to literal fields of their classes and nothing else", () => {
  const recipe = prepare({ height: 1216, prompt: "A knight", seed: 42, width: 832 });
  const snapshot = structuredClone(template);
  const graph = definition.buildGraph(recipe, {});
  const before = fields(template);

  const changed = [...fields(graph)].filter(([path, value]) => before.get(path) !== value);

  assert.deepEqual(
    new Set(changed),
    new Set([
      ["77:74.text", JSON.stringify("A knight")],
      ["77:73.noise_seed", "42"],
      ["77:66.width", "832"],
      ["77:66.height", "1216"],
      ["77:62.width", "832"],
      ["77:62.height", "1216"],
    ]),
  );
  assert.deepEqual(template, snapshot);
  assert.deepEqual(
    Object.fromEntries(
      ["77:74", "77:73", "77:66", "77:62", "78"].map((id) => [id, graph[id]?.class_type]),
    ),
    {
      "77:62": "Flux2Scheduler",
      "77:66": "EmptyFlux2LatentImage",
      "77:73": "RandomNoise",
      "77:74": "CLIPTextEncode",
      "78": "SaveImage",
    },
  );
  assert.deepEqual(definition.outputs, [{ media: "image", name: "image", nodeId: "78" }]);
  assert.deepEqual(graph["78"]?.inputs.images, ["77:65", 0]);
});

test("the workflow is the distilled template's core nodes, without primitives, loading only locked files", () => {
  assert.deepEqual(
    [...new Set(Object.values(template).map(({ class_type }) => class_type))].sort(),
    [
      "CFGGuider",
      "CLIPLoader",
      "CLIPTextEncode",
      "ConditioningZeroOut",
      "EmptyFlux2LatentImage",
      "Flux2Scheduler",
      "KSamplerSelect",
      "RandomNoise",
      "SamplerCustomAdvanced",
      "SaveImage",
      "UNETLoader",
      "VAEDecode",
      "VAELoader",
    ],
  );
  assert.deepEqual(
    [template["77:62"]?.inputs.steps, template["77:63"]?.inputs.cfg, template["77:61"]?.inputs],
    [4, 1, { sampler_name: "euler" }],
  );
  assert.equal(template["77:71"]?.inputs.type, "flux2");
});

test("a re-run or retry keeps the recipe but its seed and target; another workflow file's recipe is refused", () => {
  const recipe = prepare({ prompt: "A knight", seed: 5 });
  const selfhost = { ...cloud, kind: "selfhost" as const };

  assert.deepEqual(definition.rebase(recipe, { seed: 9, target: selfhost }), {
    ...recipe,
    params: { ...recipe.params, seed: 9 },
    target: "selfhost",
  });
  assert.equal(
    definition.rebase(
      { ...recipe, workflow: { ...recipe.workflow, sha256: "0".repeat(64) } },
      { seed: 9, target: cloud },
    ),
    null,
  );
});
