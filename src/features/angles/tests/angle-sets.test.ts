import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { startDispatcher } from "../../../shared/server/generation/dispatcher.ts";
import { findGeneration } from "../../../shared/server/generation/generations.ts";
import type { Json } from "../../../shared/server/generation/recipe-hash.ts";
import { retry } from "../../../shared/server/generation/service.ts";
import type { WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import { getCharacter } from "../../characters/api.ts";
import { type AngleSet, angleSetListSchema, angleSetSchema } from "../contracts.ts";
import { readAngleSet } from "../server/angle-sets.ts";
import {
  handleCreateAngleSet,
  handleListAngleSets,
  handleReadAngleSet,
  handleSaveView,
} from "../server/http.ts";

// The fake provider on a dead self-hosted port, so nothing can reach a real Comfy; one place in
// flight, so a set's views wait in line and the dispatcher starts them one at a time.
Object.assign(process.env, {
  COMFY_API_KEY: "",
  COMFY_BASE_URL: "http://127.0.0.1:1",
  COMFY_FAKE_STEP_MS: "0",
  COMFY_PROVIDER: "fake",
  COMFY_PROXY_TOKEN: "",
  GENERATE_RATE_LIMIT: "1000",
  IN_FLIGHT_MAX: "1",
});

/** The seeded sample characters, by slug: generated ones, whose images are stored. */
const samples = z
  .array(z.object({ id: z.uuid() }))
  .parse(database.prepare("SELECT id FROM characters WHERE is_sample = 1 ORDER BY slug").all())
  .map(({ id }) => id);

/** A new access code for `max` generations, its signed-in `Cookie` header and its usage. */
async function signedIn(max: number) {
  const code = mintCode(max);

  const login = await createAccessGuard({ production: false })(
    new Request("http://localhost/api/session", {
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  return {
    cookie: login?.headers.get("Set-Cookie")?.split(";")[0] ?? "",
    used: () => findAccessCode(code)?.used ?? 0,
  };
}

function request(path: string, cookie: string | null, body?: Json) {
  return new Request(`http://localhost${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    method: body === undefined ? "GET" : "POST",
  });
}

async function postSet(body: Json, cookie: string | null, provider?: Provider) {
  const response = await handleCreateAngleSet(request("/api/angle-sets", cookie, body), provider);

  return { body: await response.json(), status: response.status };
}

function countRows() {
  return z
    .object({ generations: z.int(), sets: z.int() })
    .parse(
      database
        .prepare(
          "SELECT (SELECT count(*) FROM generations) AS generations, (SELECT count(*) FROM angle_sets) AS sets",
        )
        .get(),
    );
}

const recipeSchema = z.object({
  prompt: z.string(),
  reference_image_sha256: z.string(),
  seed: z.int(),
  view: z.string(),
});

const recipeOf = (id: string) => recipeSchema.parse(findGeneration(id)?.recipe);

test("a set admits one waiting generation per view, in order, with one seed and each view's prompt, and its key admits it once", async () => {
  const { cookie, used } = await signedIn(20);
  const before = countRows();
  const key = randomUUID();

  const body = {
    character_id: samples[0],
    request_key: key,
    seed: 777_001,
    views: ["front", "three-quarter", "profile", "close-up"],
  };

  const first = await postSet(body, cookie);
  const set = angleSetSchema.parse(first.body);

  assert.equal(first.status, 201);
  assert.deepEqual(
    set.items.map((item) => [item.position, item.view, item.generation.status, item.reused]),
    body.views.map((view, position) => [position, view, "waiting", false]),
  );
  assert.equal(set.seed, 777_001);
  assert.equal(set.character?.id, samples[0]);

  const recipes = set.items.map((item) => recipeOf(item.generation.id));
  const reference = getCharacter(samples[0] ?? "")?.image.sha256;

  assert.deepEqual(
    recipes.map(({ prompt, reference_image_sha256, seed }) => ({
      prompt,
      reference_image_sha256,
      seed,
    })),
    [
      "<sks> front view eye-level shot medium shot",
      "<sks> front-right quarter view eye-level shot medium shot",
      "<sks> right side view eye-level shot medium shot",
      "<sks> front view eye-level shot close-up",
    ].map((prompt) => ({ prompt, reference_image_sha256: reference, seed: 777_001 })),
  );
  assert.deepEqual(
    set.items.map((item) => findGeneration(item.generation.id)?.batch_key),
    body.views.map(() => key),
  );
  assert.deepEqual(
    set.items.map((item) => findGeneration(item.generation.id)?.character_id),
    body.views.map(() => samples[0]),
  );
  assert.equal(used(), 4);

  // The same key again, whatever the body: the set it admitted, nothing stored or charged.
  const again = await postSet({ ...body, views: ["front"] }, cookie);

  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal(used(), 4);
  assert.deepEqual(countRows(), { generations: before.generations + 4, sets: before.sets + 1 });

  // Another code may not use it.
  const other = await signedIn(20);
  const conflict = await postSet(body, other.cookie);

  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.reason, "request_key_conflict");

  // Reads: the set, and the list with it first.
  const read = handleReadAngleSet(request(`/api/angle-sets/${set.id}`, cookie), set.id);

  assert.deepEqual(await read.json(), first.body);

  const list = angleSetListSchema.parse(
    await handleListAngleSets(request("/api/angle-sets", cookie)).json(),
  );

  assert.deepEqual(list.sets[0], {
    character: set.character,
    created_at: set.created_at,
    id: set.id,
    views: body.views.map((view) => ({ status: "waiting", view })),
  });
});

test("a refused set stores nothing: no session, no key, duplicate views, an unknown character, an exhausted code", async () => {
  const { cookie, used } = await signedIn(2);
  const before = countRows();
  const valid = { character_id: samples[1], request_key: randomUUID(), views: ["front"] };

  assert.equal((await postSet(valid, null)).status, 401);

  const { request_key: _key, ...keyless_ } = valid;
  const keyless = await postSet(keyless_, cookie);

  assert.equal(keyless.status, 400);
  assert.equal(keyless.body.reason, "invalid_input");

  const twice = await postSet({ ...valid, views: ["front", "front"] }, cookie);

  assert.equal(twice.status, 400);

  const unknownView = await postSet({ ...valid, views: ["back"] }, cookie);

  assert.equal(unknownView.status, 400);

  const missing = await postSet({ ...valid, character_id: randomUUID() }, cookie);

  assert.equal(missing.status, 404);

  const exhausted = await postSet({ ...valid, views: ["front", "profile", "close-up"] }, cookie);

  assert.equal(exhausted.status, 403);
  assert.equal(exhausted.body.reason, "code_exhausted");
  assert.equal(used(), 0);
  assert.deepEqual(countRows(), before);
  assert.equal(handleReadAngleSet(request("/api/angle-sets/x", cookie), "not-a-uuid").status, 400);
  assert.equal(handleReadAngleSet(request("/api/angle-sets/x", cookie), randomUUID()).status, 404);
  assert.equal(handleListAngleSets(request("/api/angle-sets", null)).status, 401);
});

/** Waits until every view of `id` is final, reading the database only. */
async function settled(id: string) {
  const deadline = Date.now() + 60_000;
  const final = ["done", "failed", "unknown", "cancelled"];

  for (;;) {
    const set = readAngleSet(id);

    if (set?.items.every((item) => final.includes(item.generation.status))) {
      return set;
    }

    assert.ok(Date.now() < deadline, "the set's views never finished");
    await delay(20);
  }
}

test("a set renders on the fake provider with no browser, a failed view is retried and followed, and a done view saves to the library once", async () => {
  const { cookie } = await signedIn(20);
  const graphs: WorkflowGraph[] = [];

  // Fails the first profile view of this set (its seed) the provider is sent; the dispatcher
  // also renders what earlier tests left waiting, which succeeds.
  let failProfile = true;

  const provider: Provider = {
    ...comfyProvider,
    submit: (graph, key) => {
      graphs.push(graph);

      const sent = JSON.stringify(graph);
      const profile = sent.includes("right side view") && sent.includes('"seed":777002');
      const scenario = profile && failProfile ? "provider_failed" : null;

      failProfile &&= !profile;

      return comfyProvider.submit(
        scenario
          ? { ...graph, marker: { class_type: "Note", inputs: { text: `[fake:${scenario}]` } } }
          : graph,
        key,
      );
    },
  };

  const { body } = await postSet(
    {
      character_id: samples[3],
      request_key: randomUUID(),
      seed: 777_002,
      views: ["three-quarter", "profile"],
    },
    cookie,
    provider,
  );

  const admitted = angleSetSchema.parse(body);
  const dispatcher = startDispatcher({ intervalMs: 20, provider });

  let set: AngleSet;

  try {
    set = await settled(admitted.id);

    assert.deepEqual(
      set.items.map((item) => item.generation.status),
      ["done", "failed"],
    );

    // The graph Comfy got: the uploaded reference in LoadImage, the view's prompt, the seed.
    const sent = graphs.find((graph) => graph["169"]?.inputs.seed === 777_002);

    assert.equal(sent?.["151"]?.inputs.prompt, recipeOf(set.items[0]?.generation.id ?? "").prompt);
    assert.equal(sent?.["169"]?.inputs.seed, 777_002);
    assert.notEqual(sent?.["1"]?.inputs.image ?? "input.png", "input.png");

    // The done view has its image output; the shared retry renders the failed one anew.
    assert.deepEqual(
      set.items[0]?.generation.outputs.map(({ media, name }) => [name, media]),
      [["image", "image"]],
    );
  } finally {
    await dispatcher.stop();
  }

  // The shared retry (a new seed), with the session of the code that made the set.
  const code = findGeneration(set.items[1]?.generation.id ?? "")?.access_code_id ?? "";
  const child = await retry(set.items[1]?.generation.id ?? "", { codeId: code }, provider);
  const again = startDispatcher({ intervalMs: 20, provider });

  try {
    set = await settled(admitted.id);
  } finally {
    await again.stop();
  }

  assert.equal(set.items[1]?.generation.id, child.id);
  assert.equal(set.items[1]?.generation.status, "done");
  assert.equal(set.items[1]?.attempt, 1);

  // Save to library: the user's action, once per generation.
  const save = (position: number, body: Json = {}) =>
    handleSaveView(
      request(`/api/angle-sets/${set.id}/items/${position}/character`, cookie, body),
      set.id,
      String(position),
    );

  const saved = await save(1, { title: "Profile view" });
  const character = await saved.json();

  assert.equal(saved.status, 201);
  assert.equal(character.origin, "generated");
  assert.equal(character.generation_id, child.id);
  assert.equal(character.title, "Profile view");
  assert.equal(character.prompt, "Profile view, made with Shots & Angles");

  const twice = await save(1);

  assert.equal(twice.status, 200);
  assert.equal((await twice.json()).id, character.id);
  assert.equal(readAngleSet(set.id)?.items[1]?.saved_character_id, character.id);
  assert.equal(readAngleSet(set.id)?.items[0]?.saved_character_id, null);
  assert.equal((await save(5)).status, 404);
  assert.equal((await save(1, { title: 7 })).status, 400);
  assert.equal(
    (
      await handleSaveView(
        request(`/api/angle-sets/${set.id}/items/0/character`, null, {}),
        set.id,
        "0",
      )
    ).status,
    401,
  );
});

test("a view that is not done yet is not saved", async () => {
  const { cookie } = await signedIn(5);

  const { body } = await postSet(
    { character_id: samples[4], request_key: randomUUID(), seed: 777_003, views: ["close-up"] },
    cookie,
  );

  const set = angleSetSchema.parse(body);

  const response = await handleSaveView(
    request(`/api/angle-sets/${set.id}/items/0/character`, cookie, {}),
    set.id,
    "0",
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, "not_done");
});
