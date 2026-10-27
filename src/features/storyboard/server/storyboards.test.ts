import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { startDispatcher } from "../../../shared/server/generation/dispatcher.ts";
import { findGeneration } from "../../../shared/server/generation/generations.ts";
import { retry } from "../../../shared/server/generation/service.ts";
import { assetsDirectory } from "../../../shared/server/paths.ts";
import type { WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import { IMAGE_EDIT_OUTPUT, imageEditDefinition } from "../../imageEdit/api.ts";
import { CARD_SIZE, compileCardPrompt, type Storyboard, storyboardSchema } from "../contracts.ts";
import { storyboardScenesDefinition } from "../workflows/scenes-definition.ts";
import {
  handleCreateStoryboard,
  handleGenerateCards,
  handleListStoryboards,
  handleReadStoryboard,
  handleSaveStoryboard,
} from "./http.ts";
import { createStoryboard, generateCards, readStoryboard } from "./storyboards.ts";

Object.assign(process.env, {
  COMFY_API_KEY: "",
  COMFY_BASE_URL: "http://127.0.0.1:1",
  COMFY_FAKE_STEP_MS: "0",
  COMFY_PROVIDER: "fake",
  COMFY_PROXY_TOKEN: "",
  GENERATE_RATE_LIMIT: "1000",
  IN_FLIGHT_MAX: "4",
});

const code = mintCode(500);
const session = { codeId: findAccessCode(code)?.id ?? "" };

const cookie =
  (
    await createAccessGuard({ production: false })(
      new Request("http://localhost/api/session", {
        body: JSON.stringify({ code }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    )
  )?.headers
    .get("Set-Cookie")
    ?.split(";")[0] ?? "";

// A seeded sample character (Maya): the storyboard's reference.
const character = z
  .object({ id: z.uuid() })
  .parse(database.prepare("SELECT id FROM characters WHERE slug = 'maya'").get()).id;

// Qwen3.5 4B's answer for the Maya sequence on Comfy Cloud (docs/feature-evidence/storyboard).
const qwenScenes = await readFile(
  "docs/feature-evidence/storyboard/runs/split2-maya/storyboard_scenes_00001.txt",
  "utf8",
);

const scenes = [
  "Wide shot of an empty city rooftop at sunset, the character stretches both arms overhead.",
  "Medium shot of the same rooftop at dusk, the character breakdances as the city lights come on.",
  "Close-up on the ledge at night, the character sits holding a water bottle.",
  "High-angle wide shot at night, the character sits on the ledge facing the skyline.",
];

const final = new Set(["done", "failed", "unknown", "cancelled"]);

/**
 * The fake provider, keeping every graph it is sent, answering a `SaveText` with `text` when it
 * is given (else the fixture), and failing every submit whose graph holds `failing` (a word of a
 * card's prompt) while it is set.
 */
function scripted({ text }: { text?: string } = {}) {
  const graphs: WorkflowGraph[] = [];
  let failing: string | null = null;

  const provider: Provider = {
    ...comfyProvider,
    job: async (id) => {
      const job = await comfyProvider.job(id);

      return {
        ...job,
        getOutputs: (nodeId) =>
          job.getOutputs(nodeId).map((output) =>
            text !== undefined && output.type === "file"
              ? {
                  ...output,
                  sizeBytes: Buffer.byteLength(text),
                  toFile: async (path: string) => {
                    await writeFile(path, text);

                    return path;
                  },
                }
              : output,
          ),
      };
    },
    submit: (graph, key) => {
      graphs.push(graph);

      const fails = failing !== null && JSON.stringify(graph).includes(failing);

      return comfyProvider.submit(
        fails
          ? { ...graph, marker: { class_type: "Note", inputs: { text: "[fake:provider_failed]" } } }
          : graph,
        key,
      );
    },
  };

  return {
    failWhen: (word: string | null) => {
      failing = word;
    },
    graphs,
    provider,
  };
}

/** Waits until every card that has a generation and the split are finished. */
async function settle(id: string) {
  const deadline = Date.now() + 30_000;

  for (;;) {
    const storyboard = readStoryboard(id);

    const pending = [
      storyboard?.scenes.generation?.status,
      ...(storyboard?.cards.map((card) => card.generation?.status) ?? []),
    ].filter((status) => status !== undefined && !final.has(status));

    if (storyboard && pending.length === 0) {
      return storyboard;
    }

    if (Date.now() > deadline) {
      throw new Error(`Storyboard ${id} did not settle: ${pending.join()}`);
    }

    await delay(20);
  }
}

/** Each card's generation id, image asset id and the stored image's SHA-256, by position. */
async function outputsOf(storyboard: Storyboard) {
  return Promise.all(
    storyboard.cards.map(async (card) => {
      const image = card.generation?.outputs.find((output) => output.name === IMAGE_EDIT_OUTPUT);
      const asset = image && image.media !== "text" ? findAsset(image.asset.id) : null;

      return {
        asset: asset?.id ?? null,
        bytes: asset
          ? createHash("sha256")
              .update(await readFile(resolve(assetsDirectory(), asset.path)))
              .digest("hex")
          : null,
        generation: card.generation?.id ?? null,
      };
    }),
  );
}

function manual(provider: Provider, extra: Partial<{ scenes: string[] }> = {}) {
  const { storyboard } = createStoryboard(
    {
      character_id: character,
      scenes: extra.scenes ?? scenes,
      sequence: "Maya on a rooftop from sunset to night.",
      style: "realistic",
      title: "Rooftop",
    },
    { provider, requestKey: randomUUID(), session },
  );

  assert.ok(storyboard);

  return storyboard;
}

function render(
  storyboard: Storyboard,
  positions: number[],
  provider: Provider,
  descriptions?: string[],
) {
  const { storyboard: rendered } = generateCards(
    storyboard.id,
    {
      descriptions: descriptions ?? storyboard.cards.map((card) => card.description),
      positions,
      style: storyboard.style,
      title: storyboard.title,
    },
    { provider, requestKey: randomUUID(), session },
  );

  assert.ok(rendered);

  return rendered;
}

test("a storyboard split by the text model: one storyboard-scenes generation whose four Scene lines become the cards", async () => {
  const { graphs, provider } = scripted({ text: qwenScenes });
  const dispatcher = startDispatcher({ intervalMs: 20, provider });

  try {
    const { created, storyboard } = createStoryboard(
      {
        character_id: character,
        sequence: "Maya arrives on an empty city rooftop at sunset and breakdances.",
        style: "reference",
      },
      { provider, requestKey: randomUUID(), session },
    );

    assert.equal(created, true);
    assert.equal(storyboard?.scenes.state, "writing");
    assert.deepEqual(
      storyboard?.cards.map((card) => [card.description, card.generation]),
      [
        ["", null],
        ["", null],
        ["", null],
        ["", null],
      ],
    );

    const done = await settle(storyboard?.id ?? "");
    const row = findGeneration(done.scenes.generation?.id ?? "");
    const recipe = storyboardScenesDefinition.recipeSchema.parse(row?.recipe);

    assert.equal(row?.workflow_id, "storyboard-scenes");
    assert.equal(
      recipe.request,
      "Maya arrives on an empty city rooftop at sunset and breakdances.",
    );
    assert.equal(graphs[0]?.["3"]?.inputs.prompt, recipe.request);
    assert.equal(done.scenes.state, "ready");
    assert.equal(done.cards.length, 4);
    assert.match(
      done.cards[0]?.description ?? "",
      /^Wide shot of an empty city rooftop at golden hour/,
    );
    assert.ok(done.cards.every((card) => card.description.length > 20 && card.generation === null));
  } finally {
    await dispatcher.stop();
  }
});

test("a split whose text is not four scenes is reported, the cards stay blank and editable", async () => {
  // The fake's own text: one caption, no Scene lines.
  const { provider } = scripted();
  const dispatcher = startDispatcher({ intervalMs: 20, provider });

  try {
    const { storyboard } = createStoryboard(
      { character_id: character, sequence: "A short walk.", style: "reference" },
      { provider, requestKey: randomUUID(), session },
    );

    const done = await settle(storyboard?.id ?? "");

    assert.equal(done.scenes.state, "failed");
    assert.match(done.scenes.message ?? "", /four scenes/);
    assert.deepEqual(
      done.cards.map((card) => card.description),
      ["", "", "", ""],
    );

    // A blank card cannot be rendered: 422 naming it, nothing stored.
    assert.throws(
      () => render(done, [0], provider),
      (error: Error & { status?: number }) => error.status === 422 && /Card 1/.test(error.message),
    );
    assert.deepEqual(
      readStoryboard(done.id)?.cards.map((card) => card.history),
      [0, 0, 0, 0],
    );
  } finally {
    await dispatcher.stop();
  }
});

test("generate all four, then regenerate card 2 only: cards 1, 3 and 4 keep their generations and their stored bytes", async () => {
  const { graphs, provider } = scripted();
  const dispatcher = startDispatcher({ intervalMs: 20, provider });

  try {
    const storyboard = manual(provider);

    assert.equal(storyboard.scenes.state, "manual");
    assert.deepEqual(
      storyboard.cards.map((card) => card.description),
      scenes,
    );

    const first = await settle(render(storyboard, [0, 1, 2, 3], provider).id);

    assert.deepEqual(
      first.cards.map((card) => card.generation?.status),
      ["done", "done", "done", "done"],
    );
    // Every card is its own generation of the shared image edit, at the storyboard's seed.
    assert.equal(new Set(first.cards.map((card) => card.generation?.id)).size, 4);
    assert.deepEqual(
      first.cards.map((card) => card.seed),
      Array(4).fill(first.seed),
    );

    for (const card of first.cards) {
      const row = findGeneration(card.generation?.id ?? "");
      const recipe = imageEditDefinition.recipeSchema.parse(row?.recipe);

      assert.equal(row?.workflow_id, imageEditDefinition.id);
      assert.equal(row?.character_id, character);
      assert.equal(recipe.prompt, compileCardPrompt(scenes[card.position] ?? "", "realistic"));
      assert.deepEqual([recipe.width, recipe.height], [CARD_SIZE.width, CARD_SIZE.height]);
    }

    const before = await outputsOf(first);
    const sent = graphs.length;

    // The same description again: another take of the scene, so a new seed.
    const second = await settle(render(first, [1], provider).id);
    const after = await outputsOf(second);

    assert.equal(graphs.length, sent + 1);
    assert.deepEqual([after[0], after[2], after[3]], [before[0], before[2], before[3]]);
    assert.notEqual(after[1]?.generation, before[1]?.generation);
    assert.ok(after[1]?.bytes);
    assert.deepEqual(
      second.cards.map((card) => card.history),
      [1, 2, 1, 1],
    );
    assert.notEqual(second.cards[1]?.seed, first.seed);

    // An edited description keeps the card's seed: the edit is the only change.
    const edited = [...scenes];
    edited[2] = "Close-up on the ledge at night, the character drinks from a water bottle.";

    const third = await settle(render(second, [2], provider, edited).id);

    assert.equal(third.cards[2]?.seed, first.seed);
    assert.equal(third.cards[2]?.description, edited[2]);
    assert.deepEqual((await outputsOf(third))[0], before[0]);
    assert.deepEqual((await outputsOf(third))[1], after[1]);
  } finally {
    await dispatcher.stop();
  }
});

test("a card that fails leaves the others done and is retried alone, by the storyboard or the shared retry", async () => {
  const { failWhen, provider } = scripted();
  const dispatcher = startDispatcher({ intervalMs: 20, provider });

  try {
    const storyboard = manual(provider, {
      scenes: [
        scenes[0] ?? "",
        scenes[1] ?? "",
        "Night rain on the rooftop, the character dances.",
        scenes[3] ?? "",
      ],
    });

    failWhen("Night rain");

    const first = await settle(render(storyboard, [0, 1, 2, 3], provider).id);

    assert.deepEqual(
      first.cards.map((card) => card.generation?.status),
      ["done", "done", "failed", "done"],
    );

    const before = await outputsOf(first);

    // The shared retry (a new seed) of the failed card: followed through `parent_id`.
    await retry(first.cards[2]?.generation?.id ?? "", session, provider);

    const retried = await settle(first.id);

    assert.equal(retried.cards[2]?.attempt, 1);
    assert.equal(retried.cards[2]?.generation?.status, "failed");

    // Tried again from the storyboard once the provider takes it: done, the others untouched.
    failWhen(null);

    const fixed = await settle(render(retried, [2], provider).id);
    const after = await outputsOf(fixed);

    assert.deepEqual(
      fixed.cards.map((card) => card.generation?.status),
      ["done", "done", "done", "done"],
    );
    assert.deepEqual([after[0], after[1], after[3]], [before[0], before[1], before[3]]);
    // A failed render is tried again with the seed it had.
    assert.equal(fixed.cards[2]?.seed, retried.cards[2]?.seed);
  } finally {
    await dispatcher.stop();
  }
});

function request(path: string, init: { body?: unknown; method?: string; session?: boolean } = {}) {
  return new Request(`http://localhost${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      "Content-Type": "application/json",
      "X-Client": "storyboard-test",
      ...(init.session !== false && { Cookie: cookie }),
    },
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
  });
}

test("HTTP: every endpoint needs a session; a request_key is required and admits once", async () => {
  const { provider } = scripted();

  const body = {
    character_id: character,
    scenes,
    sequence: "Maya on a rooftop.",
    title: "Keys",
  };

  for (const response of [
    await handleCreateStoryboard(
      request("/api/storyboards", { body: { ...body, request_key: randomUUID() }, session: false }),
      provider,
    ),
    handleListStoryboards(request("/api/storyboards", { session: false })),
    handleReadStoryboard(request("/api/storyboards/x", { session: false }), randomUUID()),
    await handleSaveStoryboard(
      request("/api/storyboards/x", { body: {}, method: "PUT", session: false }),
      randomUUID(),
    ),
    await handleGenerateCards(
      request("/api/storyboards/x/generations", { body: {}, session: false }),
      randomUUID(),
      provider,
    ),
  ]) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).reason, "access_required");
  }

  const missingKey = await handleCreateStoryboard(request("/api/storyboards", { body }), provider);

  assert.equal(missingKey.status, 400);

  const key = randomUUID();

  const made = await handleCreateStoryboard(
    request("/api/storyboards", { body: { ...body, request_key: key } }),
    provider,
  );

  const again = await handleCreateStoryboard(
    request("/api/storyboards", { body: { ...body, request_key: key, title: "Other" } }),
    provider,
  );

  const storyboard = storyboardSchema.parse(await made.json());

  assert.equal(made.status, 201);
  assert.equal(again.status, 200);
  assert.equal(storyboardSchema.parse(await again.json()).id, storyboard.id);
  assert.equal(storyboard.title, "Keys");
  assert.equal(storyboard.style, "reference");

  const saved = await handleSaveStoryboard(
    request(`/api/storyboards/${storyboard.id}`, {
      body: { descriptions: ["Edited.", ...scenes.slice(1)], style: "anime", title: "" },
      method: "PUT",
    }),
    storyboard.id,
  );

  const savedBody = storyboardSchema.parse(await saved.json());

  assert.equal(saved.status, 200);
  assert.deepEqual(
    [savedBody.cards[0]?.description, savedBody.style, savedBody.title],
    ["Edited.", "anime", null],
  );

  const read = handleReadStoryboard(request(`/api/storyboards/${storyboard.id}`), storyboard.id);

  assert.equal(storyboardSchema.parse(await read.json()).cards[0]?.description, "Edited.");
  assert.equal(handleReadStoryboard(request("/api/storyboards/x"), "not-a-uuid").status, 400);
  assert.equal(handleReadStoryboard(request("/api/storyboards/x"), randomUUID()).status, 404);

  const generation = {
    ...savedBody,
    descriptions: savedBody.cards.map((card) => card.description),
    positions: [1],
  };

  const renderKey = randomUUID();

  const rendered = await handleGenerateCards(
    request(`/api/storyboards/${storyboard.id}/generations`, {
      body: {
        descriptions: generation.descriptions,
        positions: [1],
        request_key: renderKey,
        style: "anime",
        title: "",
      },
    }),
    storyboard.id,
    provider,
  );

  const repeated = await handleGenerateCards(
    request(`/api/storyboards/${storyboard.id}/generations`, {
      body: {
        descriptions: generation.descriptions,
        positions: [0, 1, 2],
        request_key: renderKey,
        style: "anime",
        title: "",
      },
    }),
    storyboard.id,
    provider,
  );

  assert.equal(rendered.status, 201);
  assert.equal(repeated.status, 200);
  assert.deepEqual(
    storyboardSchema.parse(await repeated.json()).cards.map((card) => card.history),
    [0, 1, 0, 0],
  );

  // The same key for another storyboard is a conflict; nothing is rendered.
  const other = manual(provider);

  const conflict = await handleGenerateCards(
    request(`/api/storyboards/${other.id}/generations`, {
      body: {
        descriptions: scenes,
        positions: [0],
        request_key: renderKey,
        style: "reference",
        title: "",
      },
    }),
    other.id,
    provider,
  );

  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).reason, "request_key_conflict");
  assert.deepEqual(
    readStoryboard(other.id)?.cards.map((card) => card.history),
    [0, 0, 0, 0],
  );

  const list = await handleListStoryboards(request("/api/storyboards")).json();

  assert.ok(list.storyboards.some((item: { id: string }) => item.id === storyboard.id));
});
