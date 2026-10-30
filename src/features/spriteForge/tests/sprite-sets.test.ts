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
import {
  createdSpriteSheetSchema,
  defaultFacing,
  SHEET_OUTPUTS,
  spriteDirections,
  spriteSetListSchema,
  spriteSetSchema,
} from "../contracts.ts";
import {
  handleCreateSpriteSet,
  handleCreateSpriteSheet,
  handleListSpriteSets,
  handleReadSpriteSet,
} from "../server/http.ts";
import { readSpriteSet } from "../server/sprite-sets.ts";

// The fake provider on a dead self-hosted port (a sheet needs a self-hosted target, and nothing
// can reach a real Comfy); one place in flight, so the dispatcher renders one generation at a time.
Object.assign(process.env, {
  COMFY_API_KEY: "",
  COMFY_BASE_URL: "http://127.0.0.1:1",
  COMFY_FAKE_STEP_MS: "0",
  COMFY_PROVIDER: "fake",
  COMFY_PROXY_TOKEN: "",
  GENERATE_RATE_LIMIT: "1000",
  IN_FLIGHT_MAX: "1",
});

/** The seeded sample characters' ids, by slug. */
const characters = z
  .array(z.object({ id: z.uuid() }))
  .parse(database.prepare("SELECT id FROM characters WHERE is_sample = 1 ORDER BY slug").all())
  .map(({ id }) => id);

/** A fresh access code for `max` generations: its session's `Cookie` and its usage. */
async function codeFor(max: number) {
  const code = mintCode(max);
  const guard = createAccessGuard({ production: false });

  const login = await guard(
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

/** A GET (no body) or POST JSON request to `path`, signed in with `cookie` unless it is null. */
function call(path: string, cookie: string | null, body?: Json) {
  const headers = new Headers({ "Content-Type": "application/json" });

  if (cookie) {
    headers.set("Cookie", cookie);
  }

  return new Request(`http://localhost${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method: body === undefined ? "GET" : "POST",
  });
}

async function json(response: Response) {
  return { body: await response.json(), status: response.status };
}

const createSet = (body: Json, cookie: string | null, provider?: Provider) =>
  handleCreateSpriteSet(call("/api/sprite-sets", cookie, body), provider).then(json);

function forgeSheet(setId: string, body: Json, cookie: string | null, provider?: Provider) {
  const path = `/api/sprite-sets/${setId}/sheets`;

  return handleCreateSpriteSheet(call(path, cookie, body), setId, provider).then(json);
}

/** How many generations, sets and sheets the database holds. */
function tally() {
  return z.object({ generations: z.int(), sets: z.int(), sheets: z.int() }).parse(
    database
      .prepare(
        `SELECT (SELECT count(*) FROM generations) AS generations,
          (SELECT count(*) FROM sprite_sets) AS sets,
          (SELECT count(*) FROM sprite_sheets) AS sheets`,
      )
      .get(),
  );
}

// The statuses a generation never leaves.
const FINAL: readonly string[] = ["done", "failed", "unknown", "cancelled"];

/** Renders with `provider` until every current view and sheet of set `id` is final. */
async function renderAll(id: string, provider: Provider = comfyProvider) {
  const dispatcher = startDispatcher({ intervalMs: 20, provider });
  const deadline = Date.now() + 60_000;

  try {
    for (;;) {
      const set = readSpriteSet(id);

      const generations = [...(set?.views ?? []), ...(set?.sheets ?? [])].map(
        ({ generation }) => generation,
      );

      if (set && generations.every(({ status }) => FINAL.includes(status))) {
        return set;
      }

      assert.ok(Date.now() < deadline, "the set's generations never finished");
      await delay(20);
    }
  } finally {
    await dispatcher.stop();
  }
}

test("a set admits five waiting views in direction order with one seed, and its key admits it once", async () => {
  const { cookie, used } = await codeFor(20);
  const before = tally();
  const key = randomUUID();
  const body = { character_id: characters[0], request_key: key, seed: 880_001 };

  const first = await createSet(body, cookie);
  const set = spriteSetSchema.parse(first.body);

  assert.equal(first.status, 201);
  assert.deepEqual(
    set.views.map((view) => [view.position, view.direction, view.generation.status, view.reused]),
    spriteDirections.map((direction, position) => [position, direction, "waiting", false]),
  );
  assert.equal(set.seed, 880_001);
  assert.equal(set.character?.id, characters[0]);
  assert.deepEqual(set.sheets, []);
  assert.equal(set.sheets_available, true);

  const stored = set.views.map((view) => findGeneration(view.generation.id));

  assert.deepEqual(
    stored.map((row) => [row?.workflow_id, row?.batch_key, row?.character_id]),
    spriteDirections.map(() => ["sprite-view", key, characters[0]]),
  );
  assert.deepEqual(
    stored.map((row) => z.object({ direction: z.string(), seed: z.int() }).parse(row?.recipe)),
    spriteDirections.map((direction) => ({ direction, seed: 880_001 })),
  );
  assert.equal(used(), 5);

  // The same key again, whatever the body: the set it admitted, nothing stored or charged.
  const again = await createSet({ ...body, character_id: characters[1], seed: 1 }, cookie);

  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal(used(), 5);
  assert.deepEqual(tally(), {
    ...before,
    generations: before.generations + 5,
    sets: before.sets + 1,
  });

  // Reads: the set, and the list with it first.
  assert.deepEqual(
    await handleReadSpriteSet(call(`/api/sprite-sets/${set.id}`, cookie), set.id).json(),
    first.body,
  );

  const list = spriteSetListSchema.parse(
    await handleListSpriteSets(call("/api/sprite-sets", cookie)).json(),
  );

  assert.deepEqual(list.sets[0], {
    character: set.character,
    created_at: set.created_at,
    id: set.id,
    sheet_status: null,
    views: spriteDirections.map((direction) => ({ direction, status: "waiting" })),
  });
});

test("a refused set stores nothing: no session, no key, an unknown character, an exhausted code, another code's key", async () => {
  const owner = await codeFor(20);
  const taken = randomUUID();

  assert.equal(
    (
      await createSet(
        { character_id: characters[1], request_key: taken, seed: 880_002 },
        owner.cookie,
      )
    ).status,
    201,
  );

  const { cookie, used } = await codeFor(4);
  const before = tally();
  const valid = { character_id: characters[1], request_key: randomUUID(), seed: 880_003 };

  assert.equal((await createSet(valid, null)).status, 401);

  const { request_key: _key, ...keyless } = valid;

  const missingKey = await createSet(keyless, cookie);

  assert.deepEqual([missingKey.status, missingKey.body.reason], [400, "invalid_input"]);
  assert.equal((await createSet({ ...valid, character_id: randomUUID() }, cookie)).status, 404);

  // Five new views do not fit a code for four.
  const exhausted = await createSet(valid, cookie);

  assert.deepEqual([exhausted.status, exhausted.body.reason], [403, "code_exhausted"]);

  const conflict = await createSet({ ...valid, request_key: taken }, cookie);

  assert.deepEqual([conflict.status, conflict.body.reason], [409, "request_key_conflict"]);
  assert.equal(used(), 0);
  assert.deepEqual(tally(), before);
  assert.equal(handleReadSpriteSet(call("/api/sprite-sets/x", cookie), "x").status, 400);
  assert.equal(handleReadSpriteSet(call("/api/sprite-sets/x", cookie), randomUUID()).status, 404);
  assert.equal(handleReadSpriteSet(call("/api/sprite-sets/x", null), randomUUID()).status, 401);
  assert.equal(handleListSpriteSets(call("/api/sprite-sets", null)).status, 401);
});

test("a sheet waits for every view, then renders its HD and pixel atlases and their descriptions; the set lists it first", async () => {
  const { cookie } = await codeFor(20);

  const admitted = spriteSetSchema.parse(
    (
      await createSet(
        { character_id: characters[2], request_key: randomUUID(), seed: 880_004 },
        cookie,
      )
    ).body,
  );

  const before = tally();
  const ask = { facing: defaultFacing, request_key: randomUUID(), takes: 3 };
  const early = await forgeSheet(admitted.id, ask, cookie);

  assert.deepEqual([early.status, early.body.reason], [409, "views_not_done"]);
  assert.deepEqual(tally(), before);

  const unknown = await forgeSheet(randomUUID(), ask, cookie);

  assert.deepEqual([unknown.status, unknown.body.reason], [404, "not_found"]);
  assert.equal((await forgeSheet("x", ask, cookie)).status, 400);
  assert.equal((await forgeSheet(admitted.id, ask, null)).status, 401);

  const { request_key: _key, ...keyless } = ask;

  assert.equal((await forgeSheet(admitted.id, keyless, cookie)).status, 400);

  const drawn = await renderAll(admitted.id);

  assert.deepEqual(
    drawn.views.map((view) => view.generation.status),
    spriteDirections.map(() => "done"),
  );

  const first = await forgeSheet(admitted.id, ask, cookie);
  const quick = { facing: { ...defaultFacing, sw: "right" }, request_key: randomUUID(), takes: 1 };
  const second = await forgeSheet(admitted.id, quick, cookie);

  assert.deepEqual([first.status, second.status], [201, 201]);

  const { sheet } = createdSpriteSheetSchema.parse(second.body);

  assert.equal(sheet.generation.status, "waiting");
  assert.equal(findGeneration(sheet.generation.id)?.workflow_id, "sprite-sheet");
  assert.equal(findGeneration(sheet.generation.id)?.character_id, characters[2]);

  // The same key again: the sheet it admitted, nothing stored; another code may not use it.
  const counted = tally();
  const again = await forgeSheet(admitted.id, { ...quick, takes: 3 }, cookie);

  assert.equal(again.status, 200);
  assert.equal(createdSpriteSheetSchema.parse(again.body).sheet.id, sheet.id);
  assert.deepEqual(tally(), counted);

  const other = await codeFor(5);
  const conflict = await forgeSheet(admitted.id, quick, other.cookie);

  assert.deepEqual([conflict.status, conflict.body.reason], [409, "request_key_conflict"]);

  const set = await renderAll(admitted.id);

  assert.deepEqual(
    set.sheets.map(({ facing, id, takes }) => ({ facing, id, takes })),
    [
      { facing: quick.facing, id: sheet.id, takes: 1 },
      { facing: defaultFacing, id: createdSpriteSheetSchema.parse(first.body).sheet.id, takes: 3 },
    ],
  );

  const byName = (left: { name: string }, right: { name: string }) =>
    left.name.localeCompare(right.name);

  const expected = [
    { media: "image", name: SHEET_OUTPUTS.hd },
    { media: "text", name: SHEET_OUTPUTS.hdJson },
    { media: "image", name: SHEET_OUTPUTS.pixel },
    { media: "text", name: SHEET_OUTPUTS.pixelJson },
  ].sort(byName);

  for (const { generation } of set.sheets) {
    assert.equal(generation.status, "done");
    assert.deepEqual(
      generation.outputs.map(({ media, name }) => ({ media, name })).sort(byName),
      expected,
    );
  }

  const list = spriteSetListSchema.parse(
    await handleListSpriteSets(call("/api/sprite-sets", cookie)).json(),
  );

  assert.equal(list.sets.find(({ id }) => id === set.id)?.sheet_status, "done");
});

test("a failed view retried through the shared retry is followed, and the sheet is forged from its child", async () => {
  const { cookie } = await codeFor(20);

  // Fails the first west view of this set (its seed) the provider is sent; everything else the
  // dispatcher renders, this set's other views included, succeeds.
  let failWest = true;

  const provider: Provider = {
    ...comfyProvider,
    submit: (graph, key) => {
      const sent = JSON.stringify(graph);
      const west = sent.includes("right side view") && sent.includes('"seed":880005');
      const fail = west && failWest;

      failWest &&= !west;

      return comfyProvider.submit(
        fail
          ? { ...graph, marker: { class_type: "Note", inputs: { text: "[fake:provider_failed]" } } }
          : graph,
        key,
      );
    },
  };

  const admitted = spriteSetSchema.parse(
    (
      await createSet(
        { character_id: characters[3], request_key: randomUUID(), seed: 880_005 },
        cookie,
        provider,
      )
    ).body,
  );

  let set = await renderAll(admitted.id, provider);

  assert.deepEqual(
    set.views.map((view) => view.generation.status),
    ["done", "done", "failed", "done", "done"],
  );

  const ask = { facing: defaultFacing, request_key: randomUUID(), takes: 1 };
  const refused = await forgeSheet(set.id, ask, cookie, provider);

  assert.deepEqual([refused.status, refused.body.reason], [409, "views_not_done"]);

  // The shared retry (a new seed), with the session of the code that made the set.
  const failed = set.views[2]?.generation.id ?? "";

  const child = await retry(
    failed,
    { codeId: findGeneration(failed)?.access_code_id ?? "" },
    provider,
  );

  set = await renderAll(set.id, provider);

  assert.equal(set.views[2]?.generation.id, child.id);
  assert.equal(set.views[2]?.generation.status, "done");
  assert.equal(set.views[2]?.attempt, 1);

  // Admitted at all only because the west view is its child: the failed parent would be refused
  // by the sheet definition (409 `view_not_done`).
  const forged = await forgeSheet(set.id, ask, cookie, provider);

  assert.equal(forged.status, 201);

  const done = await renderAll(set.id, provider);

  assert.equal(done.sheets[0]?.generation.status, "done");
  assert.equal(done.sheets[0]?.attempt, 0);
});
