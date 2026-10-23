import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import { fakeProvider } from "../../../shared/server/comfy-provider.fake.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import {
  findGeneration,
  readOutputs,
  snapshot,
} from "../../../shared/server/generation/generations.ts";
import { readGenerationResult } from "../../../shared/server/generation/pages.ts";
import type { Json } from "../../../shared/server/generation/recipe-hash.ts";
import { readGeneration, rerun, retry } from "../../../shared/server/generation/service.ts";
import type { WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import { getCharacter } from "../../characters/api.ts";
import { characterCaptionDefinition } from "../workflows/caption-definition.ts";
import { characterGenerationDefinition } from "../workflows/definition.ts";
import {
  enhanceCaption,
  generateCharacter,
  handleCharacterCaption,
  handleCharacterGeneration,
  handleSaveCharacter,
} from "./generate.ts";

// `comfyProvider` (the default of every call below) is the fake, as in the generation service's
// tests: a self-hosted dead port, so nothing could reach a real Comfy.
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
const fixtureCaption = await readFile("tests/fixtures/fake-output.txt", "utf8");
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

/** A request to `path` with the session cookie (or none): a string body as is, else as JSON. */
function post(path: string, body: Json, withSession = true) {
  return new Request(`http://localhost${path}`, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "X-Client": "character-builder-test", ...(withSession && { Cookie: cookie }) },
    method: "POST",
  });
}

/** A done caption enhancement of `description`, with the fake's caption. */
async function doneCaption(description: string) {
  const { id } = await enhanceCaption({ description, seed: 1 }, session);

  assert.equal((await readGeneration(id))?.status, "done");

  return id;
}

/** A done character image of `caption`. */
async function doneImage(caption: string) {
  const { id } = await generateCharacter({ caption, seed: 1 }, session);

  assert.equal((await readGeneration(id))?.status, "done");

  return id;
}

test("a caption enhancement runs on the fake provider into one private text output, the caption", async () => {
  const { graphs, provider } = recording();
  const controls = { outfit: "a green tweed suit", style: "realistic" as const };

  const { id, reused } = await enhanceCaption(
    { controls, description: "An elderly gentleman", seed: 4 },
    session,
    { provider },
  );

  const recipe = characterCaptionDefinition.recipeSchema.parse(findGeneration(id)?.recipe);

  assert.equal(reused, false);
  assert.deepEqual(graphs, [characterCaptionDefinition.buildGraph(recipe, {})]);
  assert.equal(graphs[0]?.["18:11"]?.inputs.prompt, recipe.request);
  assert.deepEqual([recipe.description, recipe.controls], ["An elderly gentleman", controls]);

  const done = await readGeneration(id);
  const row = findGeneration(id);

  assert.equal(done?.status, "done");
  assert.deepEqual(row && snapshot(row).outputs, [
    { media: "text", name: "caption", text: fixtureCaption },
  ]);
  // A text-only generation has no file to show: no share page, no public output.
  assert.equal(done?.share_slug, null);
  assert.deepEqual(readOutputs(id), []);
  assert.deepEqual(readGenerationResult(id)?.outputs ?? [], []);

  // The same request again is the same recipe: its result comes back and nothing is sent.
  assert.deepEqual(
    await enhanceCaption({ controls, description: "An elderly gentleman", seed: 4 }, session, {
      provider,
    }),
    { id, reused: true },
  );
  assert.equal(graphs.length, 1);
});

test("a caption enhancement Comfy fails fails with provider_failed and stores no caption", async () => {
  const { id } = await enhanceCaption({ description: "[fake:provider_failed] A knight" }, session);
  const failed = await readGeneration(id);
  const row = findGeneration(id);

  assert.deepEqual([failed?.status, failed?.error_code], ["failed", "provider_failed"]);
  assert.deepEqual(row && snapshot(row).outputs, []);
});

test("an image from an enhanced caption copies the enhancement's provenance, ignores the client's, and sends the caption byte for byte", async () => {
  const captionId = await doneCaption("A dancer in a red tank top");

  const captionRecipe = characterCaptionDefinition.recipeSchema.parse(
    findGeneration(captionId)?.recipe,
  );

  const edited = `${fixtureCaption.trimEnd()}  She smiles.\n`;
  const { graphs, provider } = recording();

  for (const [caption, wasEdited] of [
    [fixtureCaption, false],
    [edited, true],
  ] as const) {
    const { id } = await generateCharacter(
      {
        caption,
        seed: 21,
        source: {
          caption_generation_id: captionId,
          controls: { style: "anime" },
          description: "Not what was enhanced",
        },
      },
      session,
      { provider },
    );

    const recipe = characterGenerationDefinition.recipeSchema.parse(findGeneration(id)?.recipe);

    assert.equal(recipe.caption, caption);
    assert.equal(graphs.at(-1)?.["18:4"]?.inputs.text, caption);
    assert.deepEqual(recipe.source, {
      controls: null,
      description: "A dancer in a red tank top",
      enhancement: {
        caption: fixtureCaption,
        edited: wasEdited,
        generation_id: captionId,
        model: "qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors",
        settings: captionRecipe.upsampler.settings,
        system_prompt_sha256: createHash("sha256")
          .update(captionRecipe.upsampler.system_prompt)
          .digest("hex"),
      },
    });
    // The image graph never runs the upsampler.
    assert.ok(
      Object.values(graphs.at(-1) ?? {}).every(({ class_type }) => class_type !== "TextGenerate"),
    );

    const done = await readGeneration(id);
    const [output] = readOutputs(id);

    assert.equal(done?.status, "done");
    assert.deepEqual([output?.name, output?.media], ["image", "image"]);
    assert.equal(findAsset(output?.asset.id ?? "")?.mime, "image/png");
    assert.ok(done?.share_slug);
  }
});

test("an image refuses a caption generation that is missing, not a caption or not done", async () => {
  const imageId = await doneImage("A knight");

  const failedCaption = (await enhanceCaption({ description: "[fake:provider_failed] x" }, session))
    .id;

  await readGeneration(failedCaption);

  for (const [captionId, status, reason] of [
    [crypto.randomUUID(), 404, "caption_not_found"],
    [imageId, 409, "not_caption"],
    [failedCaption, 409, "caption_not_done"],
  ] as const) {
    await assert.rejects(
      generateCharacter({ caption: "x", source: { caption_generation_id: captionId } }, session),
      (error) =>
        error instanceof GenerateError && error.status === status && error.reason === reason,
    );

    const answer = await handleCharacterGeneration(
      post("/api/character-generations", {
        caption: "x",
        source: { caption_generation_id: captionId },
      }),
    );

    assert.deepEqual([answer.status, (await answer.json()).reason], [status, reason]);
  }
});

test("an image Comfy fails fails with provider_failed and cannot be saved", async () => {
  const { id } = await generateCharacter({ caption: "[fake:provider_failed] A knight" }, session);
  const failed = await readGeneration(id);

  assert.deepEqual([failed?.status, failed?.error_code], ["failed", "provider_failed"]);
  assert.deepEqual(readOutputs(id), []);

  const saved = await handleSaveCharacter(
    post(`/api/character-generations/${id}/character`, ""),
    id,
  );

  assert.deepEqual([saved.status, (await saved.json()).reason], [409, "not_done"]);
});

test("a retry keeps the caption and its source with a new seed; a re-run of a done image is the image", async () => {
  const captionId = await doneCaption("A retried robot");

  const { id } = await generateCharacter(
    {
      caption: "[fake:provider_failed] Robot ",
      seed: 3,
      source: { caption_generation_id: captionId },
    },
    session,
  );

  await readGeneration(id);

  const parent = characterGenerationDefinition.recipeSchema.parse(findGeneration(id)?.recipe);
  const child = await retry(id, session);
  const recipe = characterGenerationDefinition.recipeSchema.parse(findGeneration(child.id)?.recipe);

  assert.notEqual(recipe.seed, parent.seed);
  assert.deepEqual({ ...recipe, seed: parent.seed }, parent);

  const doneId = await doneImage("A rerun robot");

  assert.deepEqual(await rerun(doneId, session), { id: doneId, reused: true });
});

test("POST /api/character-captions and /api/character-generations answer 201, 200 reused, and 400 for bodies that are not their input", async () => {
  const captioned = await handleCharacterCaption(
    post("/api/character-captions", { description: "A knight", seed: 13 }),
  );

  const receipt = await captioned.json();

  assert.deepEqual([captioned.status, receipt.reused], [201, false]);

  const again = await handleCharacterCaption(
    post("/api/character-captions", { description: "A knight", seed: 13 }),
  );

  assert.deepEqual([again.status, await again.json()], [200, { id: receipt.id, reused: true }]);

  const body = { caption: " A knight ", height: 1216, seed: 13, width: 832 };
  const created = await handleCharacterGeneration(post("/api/character-generations", body));
  const image = await created.json();

  assert.equal(created.status, 201);
  assert.equal(
    characterGenerationDefinition.recipeSchema.parse(findGeneration(image.id)?.recipe).caption,
    " A knight ",
  );

  for (const [handler, path, invalid] of [
    [handleCharacterCaption, "/api/character-captions", { description: " " }],
    [
      handleCharacterCaption,
      "/api/character-captions",
      { controls: { style: "x" }, description: "x" },
    ],
    [handleCharacterGeneration, "/api/character-generations", { prompt: "x" }],
    [handleCharacterGeneration, "/api/character-generations", { caption: "x", width: 100 }],
    [handleCharacterGeneration, "/api/character-generations", "not json"],
  ] as const) {
    const refused = await handler(post(path, invalid));

    assert.deepEqual([refused.status, (await refused.json()).reason], [400, "invalid_input"]);
  }

  // Not public: without a session the access guard answers 401 before any handler runs.
  for (const path of [
    "/api/character-captions",
    "/api/character-generations",
    `/api/character-generations/${image.id}/character`,
  ]) {
    assert.equal((await guard(post(path, {}, false)))?.status, 401, path);
  }
});

test("the same request_key returns the first generation without another submit, and never enhances again", async () => {
  const before = { submits: fakeProvider.calls.submit, used: findAccessCode(code)?.used ?? 0 };
  const captionKey = crypto.randomUUID();
  const captionBody = { description: "A lost answer", request_key: captionKey };

  const first = await (
    await handleCharacterCaption(post("/api/character-captions", captionBody))
  ).json();

  await readGeneration(first.id);

  const repeated = await handleCharacterCaption(post("/api/character-captions", captionBody));

  assert.deepEqual(await repeated.json(), first);

  const imageBody = {
    caption: fixtureCaption,
    request_key: crypto.randomUUID(),
    source: { caption_generation_id: first.id },
  };

  const image = await (
    await handleCharacterGeneration(post("/api/character-generations", imageBody))
  ).json();

  const again = await handleCharacterGeneration(post("/api/character-generations", imageBody));

  assert.deepEqual(await again.json(), image);
  assert.equal(findGeneration(image.id)?.request_key, imageBody.request_key);
  // One caption and one image submitted; no second caption, no second image.
  assert.equal(fakeProvider.calls.submit - before.submits, 2);
  assert.equal(findAccessCode(code)?.used, before.used + 2);

  // Without the key, the same blank-seed request draws another seed: another generation.
  const unkeyed = await (
    await handleCharacterGeneration(post("/api/character-generations", { caption: fixtureCaption }))
  ).json();

  assert.notEqual(unkeyed.id, image.id);
});

test("POST /api/character-generations/:id/character saves the image once, explicitly, and refuses anything else", async () => {
  const captionId = await doneCaption("A saved musician");

  const { id } = await generateCharacter(
    { caption: fixtureCaption, seed: 8, source: { caption_generation_id: captionId } },
    session,
  );

  await readGeneration(id);

  // Nothing is saved on its own.
  assert.equal(findGeneration(id)?.character_id, null);

  const path = `/api/character-generations/${id}/character`;
  const created = await handleSaveCharacter(post(path, { title: "Musician" }), id);
  const character = await created.json();
  const [output] = readOutputs(id);

  assert.equal(created.status, 201);
  assert.deepEqual(
    [
      character.origin,
      character.generation_id,
      character.image_asset_id,
      character.prompt,
      character.title,
    ],
    ["generated", id, output?.asset.id, fixtureCaption, "Musician"],
  );
  assert.deepEqual(character.provenance, {
    models: characterGenerationDefinition.models,
    workflow: findGeneration(id)?.recipe.workflow,
  });
  assert.deepEqual(getCharacter(character.id)?.id, character.id);

  // Idempotent: the same character again, with an empty body too.
  for (const body of ["", {}, { title: "Another" }]) {
    const again = await handleSaveCharacter(post(path, body), id);

    assert.deepEqual([again.status, (await again.json()).id], [200, character.id]);
  }

  for (const [target, status, reason] of [
    [crypto.randomUUID(), 404, "not_found"],
    [captionId, 409, "not_character_generation"],
  ] as const) {
    const refused = await handleSaveCharacter(
      post(`/api/character-generations/${target}/character`, ""),
      target,
    );

    assert.deepEqual([refused.status, (await refused.json()).reason], [status, reason]);
  }

  const malformed = await handleSaveCharacter(
    post("/api/character-generations/x/character", ""),
    "x",
  );

  assert.equal(malformed.status, 400);

  const badBody = await handleSaveCharacter(post(path, { title: 5 }), id);

  assert.deepEqual([badBody.status, (await badBody.json()).reason], [400, "invalid_input"]);
});
