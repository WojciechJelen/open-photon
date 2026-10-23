import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import { fakeProvider } from "../../../shared/server/comfy-provider.fake.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { findGeneration, readOutputs } from "../../../shared/server/generation/generations.ts";
import {
  readGenerationResult,
  readGenerationShare,
} from "../../../shared/server/generation/pages.ts";
import { readGeneration } from "../../../shared/server/generation/service.ts";
import { assetsDirectory } from "../../../shared/server/paths.ts";
import type { WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import { createFromGeneration } from "../../characters/api.ts";
import { characterGenerationDefinition } from "../workflows/definition.ts";
import { generateCharacter, handleCharacterGeneration } from "./generate.ts";

// `comfyProvider` (the default of every call below) is the fake, as in the generation service's
// tests: a self-hosted dead port, so nothing could reach a real Comfy.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

// Every answer below but a reused result takes a token; the default (3 a minute) would refuse.
process.env.GENERATE_RATE_LIMIT = "100";

const code = mintCode(100);
const session = { codeId: findAccessCode(code)?.id ?? "" };

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

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

test("a character generation runs submit → done on the fake provider into one image output, no poster, no upload", async () => {
  const { graphs, provider } = recording();
  const before = { ...fakeProvider.calls };
  const prompt = "A street dancer in a red hoodie, full body, plain background";
  const { id, reused } = await generateCharacter({ prompt, seed: 11 }, session, provider);
  const queued = findGeneration(id);

  assert.equal(reused, false);
  assert.equal(queued?.status, "queued");
  assert.equal(queued?.provider_inputs, null);
  assert.deepEqual([queued?.workflow_id, queued?.workflow_version], ["character-generation", 1]);
  assert.equal(fakeProvider.calls.upload - before.upload, 0);
  assert.equal(graphs.length, 1);
  assert.deepEqual(
    graphs[0],
    characterGenerationDefinition.buildGraph(
      characterGenerationDefinition.recipeSchema.parse(queued?.recipe),
      {},
    ),
  );
  assert.equal(graphs[0]?.["77:74"]?.inputs.text, prompt);

  const done = await readGeneration(id);

  assert.equal(done?.status, "done");
  assert.deepEqual([done?.final_asset_id, done?.poster_asset_id], [null, null]);

  const outputs = readOutputs(id);
  const image = findAsset(outputs[0]?.asset.id ?? "");
  const fixture = await sha256("tests/fixtures/fake-output.png");

  assert.deepEqual(
    outputs.map(({ media, name }) => ({ media, name })),
    [{ media: "image", name: "image" }],
  );
  assert.deepEqual([image?.kind, image?.mime, image?.sha256], ["image", "image/png", fixture]);
  assert.equal(await sha256(resolve(assetsDirectory(), image?.path ?? "")), fixture);

  // `/g/:id` and `/r/:slug` render it by its outputs.
  assert.deepEqual(readGenerationResult(id)?.workflow, { id: "character-generation", version: 1 });
  assert.deepEqual(readGenerationResult(id)?.outputs, outputs);
  assert.equal(
    readGenerationShare(done?.share_slug ?? "", "https://photon.example")?.outputs[0]?.url,
    `https://photon.example/media/${image?.id}.png`,
  );

  // The same input is the same recipe: its result comes back and nothing is sent.
  assert.deepEqual(await generateCharacter({ prompt, seed: 11 }, session, provider), {
    id,
    reused: true,
  });
  assert.equal(graphs.length, 1);

  // DEV-294's save: the image becomes a generated character carrying the recipe's provenance.
  const { character, created } = createFromGeneration({ generationId: id, outputName: "image" });

  assert.equal(created, true);
  assert.deepEqual(
    [character.origin, character.generation_id, character.image_asset_id, character.prompt],
    ["generated", id, image?.id, prompt],
  );
  assert.deepEqual(character.provenance, {
    models: characterGenerationDefinition.models,
    workflow: findGeneration(id)?.recipe.workflow,
  });
  assert.deepEqual(createFromGeneration({ generationId: id, outputName: "image" }), {
    character,
    created: false,
  });
});

test("a job Comfy fails fails the generation with provider_failed and stores no output", async () => {
  const { id } = await generateCharacter(
    { prompt: "[fake:provider_failed] A knight", seed: 12 },
    session,
  );

  const failed = await readGeneration(id);

  assert.deepEqual([failed?.status, failed?.error_code], ["failed", "provider_failed"]);
  assert.deepEqual(readOutputs(id), []);
  assert.throws(() => createFromGeneration({ generationId: id, outputName: "image" }), {
    reason: "not_done",
  });
});

test("POST /api/character-generations answers 201, then 200 reused, and 400 for a body that is not the input", async () => {
  const guard = createAccessGuard({ production: true });

  const login = await guard(
    new Request("http://localhost/api/session", {
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  const cookie = login?.headers.get("Set-Cookie")?.split(";")[0] ?? "";

  const post = (body: string) =>
    handleCharacterGeneration(
      new Request("http://localhost/api/character-generations", {
        body,
        headers: { Cookie: cookie, "X-Client": "character-builder" },
        method: "POST",
      }),
    );

  const body = JSON.stringify({ height: 1216, prompt: "A knight", seed: 13, width: 832 });
  const created = await post(body);
  const receipt = await created.json();

  assert.equal(created.status, 201);
  assert.equal(receipt.reused, false);
  assert.deepEqual(findGeneration(receipt.id)?.recipe.params, {
    height: 1216,
    prompt: "A knight",
    seed: 13,
    width: 832,
  });

  const again = await post(body);

  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { id: receipt.id, reused: true });

  for (const invalid of ["{}", JSON.stringify({ prompt: "x", width: 100 }), "not json"]) {
    const refused = await post(invalid);

    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).reason, "invalid_input");
  }

  // Not public: without a session the access guard answers 401 before the handler runs.
  const anonymous = await guard(
    new Request("http://localhost/api/character-generations", { body, method: "POST" }),
  );

  assert.equal(anonymous?.status, 401);
});
