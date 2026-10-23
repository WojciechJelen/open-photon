import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { z } from "zod";

import { findGeneration } from "../../../shared/server/generation/generations.ts";
import { submit } from "../../../shared/server/generation/service.ts";
import { batchListSchema, batchSchema, createBatchInputSchema } from "../contracts.ts";
import { createBatch, readBatch } from "../server/batches.ts";
import { handleCreateBatch, handleListBatches, handleReadBatch } from "../server/http.ts";
import { characters, counts, motion, motionTransfer, newSession, signIn } from "./fixtures.ts";

// No dispatcher runs in this file: every admitted item stays `waiting`, as a batch is stored.

const look = "Background: a rooftop at golden hour.";

// The recipe members a batch varies or keeps, as Motion Transfer stores them.
const recipeSchema = z.object({
  params: z.object({ prompt: z.string(), seed: z.int() }).loose(),
});

function paramsOf(id: string) {
  return recipeSchema.parse(findGeneration(id)?.recipe).params;
}

let nextSeed = 1000;

/** Seeds no other test here uses, so reuse only ever finds what a test made itself. */
function seeds(count: number) {
  return Array.from({ length: count }, () => (nextSeed += 1));
}

/**
 * A `POST /api/batches` body as a client might send it, malformed ones included: the shot's
 * members may be missing or of the wrong type.
 */
type Body = {
  request_key?: string;
  shot: { character?: string; motion?: string; prompt?: number | string; seed?: number | string };
  variation: {
    characters?: ReadonlyArray<string | undefined>;
    kind: string;
    seeds?: readonly number[];
  };
};

/** A seed batch's body over the sample motion and first sample character, with `look`. */
function seedBody(values: number[], shot: Body["shot"] = {}): Body {
  return {
    shot: { character: characters[0], motion, prompt: look, seed: 7, ...shot },
    variation: { kind: "seeds", seeds: values },
  };
}

/** `POST /api/batches` with `body` (and its `request_key`) for the session `cookie` names. */
async function post(body: Body, cookie: string) {
  const response = await handleCreateBatch(
    new Request("http://localhost/api/batches", {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    }),
    motionTransfer,
  );

  return { body: await response.json(), status: response.status };
}

test("a seed batch stores every item waiting in order, one charged generation each, keeping the shot's motion and look", () => {
  const { session, used } = newSession(20);
  const before = counts();
  const values = seeds(4);
  const requestKey = randomUUID();

  const { batch, created } = createBatch(
    motionTransfer,
    createBatchInputSchema.parse(seedBody(values)),
    { requestKey, session },
  );

  assert.equal(created, true);
  assert.ok(batch);
  assert.equal(batch.kind, "seeds");
  assert.deepEqual(
    batch.items.map((item) => [item.position, item.generation.status, item.reused, item.attempt]),
    [0, 1, 2, 3].map((position) => [position, "waiting", false, 0]),
  );
  assert.deepEqual(
    batch.items.map((item) => item.variation),
    values.map((seed) => ({ seed })),
  );

  // Distinct resolved inputs: each item renders its own seed; motion, character and look are the
  // shot's.
  assert.deepEqual(
    batch.items.map((item) => item.seed),
    values,
  );

  const first = paramsOf(batch.items[0]?.generation.id ?? "");

  assert.equal(first.prompt, look);
  assert.deepEqual(
    batch.items.map((item) => paramsOf(item.generation.id)),
    values.map((seed) => ({ ...first, seed })),
  );
  assert.deepEqual(
    batch.items.map((item) => item.character?.id),
    values.map(() => characters[0]),
  );

  // In line in the batch's order, each tagged with the batch's request key.
  const start = batch.items[0]?.generation.position ?? 0;

  assert.deepEqual(
    batch.items.map((item) => item.generation.position),
    [start, start + 1, start + 2, start + 3],
  );
  assert.deepEqual(
    batch.items.map((item) => findGeneration(item.generation.id)?.batch_key),
    values.map(() => requestKey),
  );
  assert.deepEqual(batch.shot, { character: characters[0], motion, prompt: look, seed: 7 });
  assert.equal(used(), 4);
  assert.deepEqual(counts(), { batches: before.batches + 1, generations: before.generations + 4 });
  assert.deepEqual(readBatch(batch.id), batch);
});

test("a character batch applies one motion, look and seed to each character", () => {
  const { session, used } = newSession(20);
  const picked = characters.slice(0, 3);

  const { batch } = createBatch(
    motionTransfer,
    createBatchInputSchema.parse({
      shot: { character: characters[5], motion, prompt: look, seed: 4242 },
      variation: { characters: picked, kind: "characters" },
    }),
    { requestKey: randomUUID(), session },
  );

  assert.ok(batch);
  assert.equal(batch.kind, "characters");
  assert.deepEqual(
    batch.items.map((item) => [item.variation, item.character?.id, item.seed]),
    picked.map((id) => [{ character_id: id }, id, 4242]),
  );
  assert.deepEqual(
    batch.items.map((item) => findGeneration(item.generation.id)?.character_id),
    picked,
  );
  assert.deepEqual(
    new Set(batch.items.map((item) => JSON.stringify(paramsOf(item.generation.id)))).size,
    1,
  );
  // The common shot has no character of its own.
  assert.deepEqual(batch.shot, { motion, prompt: look, seed: 4242 });
  assert.equal(used(), 3);
});

test("the same request key returns the same batch and items, stores and charges nothing, and refuses another code", async () => {
  const owner = newSession(20);
  const cookie = await signIn(owner.code);
  const body = { ...seedBody(seeds(2)), request_key: randomUUID() };

  const first = await post(body, cookie);

  assert.equal(first.status, 201);
  assert.equal(batchSchema.parse(first.body).items.length, 2);

  const before = counts();

  // A lost answer asked again, and a reload that sends the same key with another body: the
  // batch the key admitted, as it is.
  for (const again of [body, { ...seedBody(seeds(4)), request_key: body.request_key }]) {
    const repeated = await post(again, cookie);

    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body, first.body);
  }

  assert.deepEqual(counts(), before);
  assert.equal(owner.used(), 2);

  const other = newSession(20);
  const refused = await post(body, await signIn(other.code));

  assert.equal(refused.status, 409);
  assert.equal(refused.body.reason, "request_key_conflict");
  assert.equal(other.used(), 0);
  assert.deepEqual(counts(), before);
});

test("invalid input stores nothing: a bad body, a missing key, an unknown character, a seed count other than 2 or 4", async () => {
  const { code, used } = newSession(20);
  const cookie = await signIn(code);
  const before = counts();

  const refusals = [
    // Three seeds; a repeated seed; no request key; a shot without motion; a mangled look.
    [{ ...seedBody(seeds(3)), request_key: randomUUID() }, 400],
    [{ ...seedBody([5, 5]), request_key: randomUUID() }, 400],
    [seedBody(seeds(2)), 400],
    [{ ...seedBody(seeds(2), { motion: undefined }), request_key: randomUUID() }, 400],
    [{ ...seedBody(seeds(2), { prompt: 42 }), request_key: randomUUID() }, 400],
    [{ ...seedBody(seeds(2), { character: undefined }), request_key: randomUUID() }, 400],
    // One of the characters does not exist: the workflow refuses that item, so none is stored.
    [
      {
        request_key: randomUUID(),
        shot: { motion, prompt: look, seed: 1 },
        variation: { characters: [characters[0], randomUUID()], kind: "characters" },
      },
      404,
    ],
  ] as const;

  for (const [body, status] of refusals) {
    const refused = await post(body, cookie);

    assert.equal(refused.status, status, JSON.stringify(body));
    assert.equal(typeof refused.body.error, "string");
  }

  assert.deepEqual(counts(), before);
  assert.equal(used(), 0);
});

test("a code without room for every new item refuses the whole batch; reused takes are free", async () => {
  const { code, used } = newSession(3);
  const cookie = await signIn(code);
  const before = counts();
  const values = seeds(4);

  const refused = await post({ ...seedBody(values), request_key: randomUUID() }, cookie);

  assert.equal(refused.status, 403);
  assert.equal(refused.body.reason, "code_exhausted");
  assert.deepEqual(counts(), before);
  assert.equal(used(), 0);

  // Someone else in the workspace already has a take of one of the seeds (done or on its way):
  // the batch gets it back free, so the same four now fit in this code's three generations.
  const colleague = newSession(5);

  const existing = await submit(
    motionTransfer,
    { character_id: characters[0], motion_asset_id: motion, prompt: look, seed: values[1] },
    { scope: { free: () => false, session: colleague.session } },
  );

  assert.equal(colleague.used(), 1);

  const admitted = await post({ ...seedBody(values), request_key: randomUUID() }, cookie);
  const batch = batchSchema.parse(admitted.body);

  assert.equal(admitted.status, 201);
  assert.deepEqual(
    batch.items.map((item) => item.reused),
    [false, true, false, false],
  );
  assert.equal(batch.items[1]?.generation.id, existing.id);
  assert.equal(used(), 3);
  assert.equal(colleague.used(), 1);
  // The colleague's take and the batch's three new ones.
  assert.deepEqual(counts(), { batches: before.batches + 1, generations: before.generations + 4 });
});

test("the batch endpoints need a session; GET answers the batch, the list and the allowance", async () => {
  const { code, session } = newSession(10);
  const cookie = await signIn(code);

  const { batch } = createBatch(motionTransfer, createBatchInputSchema.parse(seedBody(seeds(2))), {
    requestKey: randomUUID(),
    session,
  });

  assert.ok(batch);

  const read = (path: string, headers: Record<string, string> = {}) =>
    path === "/api/batches"
      ? handleListBatches(new Request(`http://localhost${path}`, { headers }))
      : handleReadBatch(
          new Request(`http://localhost${path}`, { headers }),
          path.split("/")[3] ?? "",
        );

  for (const path of ["/api/batches", `/api/batches/${batch.id}`]) {
    const anonymous = read(path);

    assert.equal(anonymous.status, 401, path);
    assert.equal((await anonymous.json()).reason, "access_required");
  }

  assert.deepEqual(await read(`/api/batches/${batch.id}`, { Cookie: cookie }).json(), batch);
  assert.equal(read(`/api/batches/${randomUUID()}`, { Cookie: cookie }).status, 404);
  assert.equal(read("/api/batches/nope", { Cookie: cookie }).status, 400);

  const list = batchListSchema.parse(await read("/api/batches", { Cookie: cookie }).json());

  assert.deepEqual(list.allowance, { max: 10, remaining: 8, used: 2 });
  assert.deepEqual(list.batches[0], {
    created_at: batch.created_at,
    id: batch.id,
    kind: "seeds",
    statuses: ["waiting", "waiting"],
  });

  const unauthorized = await handleCreateBatch(
    new Request("http://localhost/api/batches", {
      body: JSON.stringify({ ...seedBody(seeds(2)), request_key: randomUUID() }),
      method: "POST",
    }),
    motionTransfer,
  );

  assert.equal(unauthorized.status, 401);
});
