import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { mediaUrl } from "../../../shared/media.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { startDispatcher } from "../../../shared/server/generation/dispatcher.ts";
import { retry } from "../../../shared/server/generation/service.ts";
import { characterSummarySchema } from "../../characters/index.ts";
import { type Photoshoot, photoshootListSchema, photoshootSchema } from "../contracts.ts";
import {
  handleCreatePhotoshoot,
  handleListPhotoshoots,
  handleReadPhotoshoot,
  handleSaveShot,
} from "../server/http.ts";
import { readPhotoshoot } from "../server/photoshoots.ts";
import { compileShotPrompt, photoshootSetting } from "../settings.ts";

// The fake provider on a dead self-hosted port: nothing here can reach a real Comfy.
Object.assign(process.env, {
  COMFY_API_KEY: "",
  COMFY_BASE_URL: "http://127.0.0.1:1",
  COMFY_FAKE_STEP_MS: "0",
  COMFY_PROVIDER: "fake",
  COMFY_PROXY_TOKEN: "",
  GENERATE_RATE_LIMIT: "1000",
  IN_FLIGHT_MAX: "1",
});

const guard = createAccessGuard({ production: false });

/** A new access code for `max` generations and the `Cookie` of a session signed in with it. */
async function signedIn(max = 40) {
  const code = mintCode(max);

  const login = await guard(
    new Request("http://localhost/api/session", {
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  return {
    cookie: login?.headers.get("Set-Cookie")?.split(";")[0] ?? "",
    session: { codeId: findAccessCode(code)?.id ?? "" },
    used: () => findAccessCode(code)?.used ?? 0,
  };
}

const [maya] = z
  .array(z.object({ id: z.uuid() }))
  .parse(database.prepare("SELECT id FROM characters WHERE slug = 'maya'").all())
  .map(({ id }) => id);

/** A request body as a client might send it, malformed ones included. */
type Body = {
  character_id?: string;
  generation_id?: string;
  request_key?: string;
  setting?: string;
  title?: string;
};

function request(path: string, cookie: string | null, body?: Body) {
  return new Request(`http://localhost${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    method: body === undefined ? "GET" : "POST",
  });
}

async function create(cookie: string | null, body: Body) {
  const response = await handleCreatePhotoshoot(request("/api/photoshoots", cookie, body));

  return { body: await response.json(), status: response.status };
}

function generationCount() {
  return z
    .object({ n: z.int() })
    .parse(database.prepare("SELECT count(*) AS n FROM generations").get()).n;
}

const final = { cancelled: true, done: true, failed: true, unknown: true } satisfies Record<
  string,
  true
>;

/** Waits until every shot of `id` is final, reading the database only (no browser, no stream). */
async function settle(id: string) {
  const deadline = Date.now() + 60_000;

  while (!readPhotoshoot(id)?.items.every((item) => item.generation.status in final)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for photoshoot ${id}`);
    }

    await delay(20);
  }

  return photoshootSchema.parse(readPhotoshoot(id));
}

/** The fake provider, keeping every prompt-bearing graph and failing the one naming `failing`. */
function scripted(failing?: string) {
  const sent: string[] = [];

  const provider: Provider = {
    ...comfyProvider,
    submit: (graph, key) => {
      const text = JSON.stringify(graph);

      sent.push(text);

      return comfyProvider.submit(
        failing && text.includes(failing)
          ? { ...graph, marker: { class_type: "Note", inputs: { text: "[fake:provider_failed]" } } }
          : graph,
        key,
      );
    },
  };

  return { provider, sent };
}

test("a photoshoot admits four waiting shots of the setting, renders each into one image, and survives a re-read", async () => {
  const { cookie, used } = await signedIn();
  const { provider, sent } = scripted();

  const { body, status } = await create(cookie, {
    character_id: maya,
    request_key: randomUUID(),
    setting: "street",
  });

  assert.equal(status, 201);

  const admitted = photoshootSchema.parse(body);

  assert.equal(admitted.items.length, 4);
  assert.equal(admitted.character?.id, maya);
  assert.equal(used(), 4);

  const waiting = photoshootListSchema.parse(
    await handleListPhotoshoots(request("/api/photoshoots", cookie)).json(),
  );

  // No shot is done: no image yet, one place for each.
  assert.deepEqual(waiting.photoshoots.find(({ id }) => id === admitted.id)?.stills, [
    null,
    null,
    null,
    null,
  ]);

  const dispatcher = startDispatcher({ intervalMs: 20, provider });

  try {
    const done = await settle(admitted.id);

    assert.deepEqual(
      done.items.map((item) => item.generation.status),
      ["done", "done", "done", "done"],
    );

    for (const item of done.items) {
      assert.deepEqual(
        item.generation.outputs
          .filter(({ media }) => media !== "text")
          .map(({ media, name }) => ({ media, name })),
        [{ media: "image", name: "image" }],
      );
      assert.equal(item.generation.character_id, maya);
    }

    // Every shot was sent with its own server-composed prompt: four different poses and lights.
    for (const shot of [0, 1, 2, 3]) {
      const prompt = JSON.stringify(compileShotPrompt("street", shot)).slice(1, -1);

      assert.equal(sent.filter((graph) => graph.includes(prompt)).length, 1, `shot ${shot}`);
    }

    // What the page reads after a reload: the same photoshoot from the database.
    const read = handleReadPhotoshoot(request(`/api/photoshoots/${done.id}`, cookie), done.id);

    assert.deepEqual(photoshootSchema.parse(await read.json()), done);

    const list = photoshootListSchema.parse(
      await handleListPhotoshoots(request("/api/photoshoots", cookie)).json(),
    );

    const listed = list.photoshoots.find(({ id }) => id === done.id);

    assert.deepEqual(listed?.statuses, ["done", "done", "done", "done"]);
    // Each shot's image, for the row's thumbnails.
    assert.deepEqual(
      listed?.stills.map((still) => still?.id),
      done.items.flatMap(({ generation }) =>
        generation.outputs.flatMap((output) => ("asset" in output ? [output.asset.id] : [])),
      ),
    );
  } finally {
    await dispatcher.stop();
  }
});

test("a shot the provider fails leaves the others done, and the shared retry renders it again", async () => {
  const { cookie, session } = await signedIn();
  // The second studio shot is the arms-crossed portrait.
  const failing = photoshootSetting("studio").shots[1].pose;
  const { provider } = scripted(failing);

  const { body } = await create(cookie, {
    character_id: maya,
    request_key: randomUUID(),
    setting: "studio",
  });

  const admitted = photoshootSchema.parse(body);
  const dispatcher = startDispatcher({ intervalMs: 20, provider });

  try {
    const settled = await settle(admitted.id);

    assert.deepEqual(
      settled.items.map((item) => item.generation.status),
      ["done", "failed", "done", "done"],
    );
    assert.equal(settled.items[1]?.generation.error_code, "provider_failed");

    const stillsOf = async () => {
      const list = photoshootListSchema.parse(
        await handleListPhotoshoots(request("/api/photoshoots", cookie)).json(),
      );

      return list.photoshoots
        .find(({ id }) => id === admitted.id)
        ?.stills.map((still) => still !== null);
    };

    // The failed shot's place stays empty, in its position.
    assert.deepEqual(await stillsOf(), [true, false, true, true]);

    // The retry goes through a provider that no longer fails.
    const failed = settled.items[1]?.generation.id ?? "";
    const retried = await retry(failed, session, comfyProvider);
    const after: Photoshoot = await settle(admitted.id);

    assert.equal(after.items[1]?.generation.id, retried.id);
    assert.equal(after.items[1]?.attempt, 1);
    assert.deepEqual(
      after.items.map((item) => item.generation.status),
      ["done", "done", "done", "done"],
    );

    // The list follows the shot to its retry.
    assert.deepEqual(await stillsOf(), [true, true, true, true]);
  } finally {
    await dispatcher.stop();
  }
});

test("the same request key returns the first photoshoot and stores nothing; another code's key is a conflict", async () => {
  const first = await signedIn();
  const other = await signedIn();
  const key = randomUUID();

  const one = await create(first.cookie, {
    character_id: maya,
    request_key: key,
    setting: "editorial",
  });

  const before = generationCount();

  const again = await create(first.cookie, {
    character_id: maya,
    request_key: key,
    setting: "outdoors",
  });

  assert.equal(one.status, 201);
  assert.equal(again.status, 200);
  assert.equal(photoshootSchema.parse(again.body).id, photoshootSchema.parse(one.body).id);
  assert.equal(photoshootSchema.parse(again.body).setting, "editorial");
  assert.equal(generationCount(), before);
  assert.equal(first.used(), 4);

  const conflict = await create(other.cookie, {
    character_id: maya,
    request_key: key,
    setting: "editorial",
  });

  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.reason, "request_key_conflict");
  assert.equal(other.used(), 0);
});

test("refusals store nothing: no session, no request key, an unknown character, a quota too small", async () => {
  const before = generationCount();
  const { cookie } = await signedIn();
  const small = await signedIn(3);

  assert.equal(
    (await create(null, { character_id: maya, request_key: randomUUID(), setting: "studio" }))
      .status,
    401,
  );
  assert.equal((await create(cookie, { character_id: maya, setting: "studio" })).status, 400);
  assert.equal(
    (await create(cookie, { character_id: maya, request_key: randomUUID(), setting: "moon" }))
      .status,
    400,
  );

  const unknown = await create(cookie, {
    character_id: randomUUID(),
    request_key: randomUUID(),
    setting: "studio",
  });

  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.reason, "character_not_found");

  const exhausted = await create(small.cookie, {
    character_id: maya,
    request_key: randomUUID(),
    setting: "studio",
  });

  assert.equal(exhausted.status, 403);
  assert.equal(exhausted.body.reason, "code_exhausted");
  assert.equal(generationCount(), before);

  const id = randomUUID();

  assert.equal(handleListPhotoshoots(request("/api/photoshoots", null)).status, 401);
  assert.equal(handleReadPhotoshoot(request(`/api/photoshoots/${id}`, null), id).status, 401);
  assert.equal(
    (
      await handleSaveShot(
        request(`/api/photoshoots/${id}/character`, null, { generation_id: id }),
        id,
      )
    ).status,
    401,
  );
  assert.equal(handleReadPhotoshoot(request(`/api/photoshoots/${id}`, cookie), id).status, 404);
});

test("the list, a photoshoot and their images need a session; a malformed id is not_found behind it", async () => {
  const { cookie } = await signedIn();

  const { body } = await create(cookie, {
    character_id: maya,
    request_key: randomUUID(),
    setting: "editorial",
  });

  const admitted = photoshootSchema.parse(body);
  const dispatcher = startDispatcher({ intervalMs: 20 });

  try {
    await settle(admitted.id);

    const list = photoshootListSchema.parse(
      await handleListPhotoshoots(request("/api/photoshoots", cookie)).json(),
    );

    const still = list.photoshoots.find(({ id }) => id === admitted.id)?.stills[0];

    assert.ok(still);

    // Nothing here is public: the guard stops a request without a session before any handler.
    for (const path of ["/api/photoshoots", `/api/photoshoots/${admitted.id}`, mediaUrl(still)]) {
      assert.equal((await guard(request(path, null)))?.status, 401, path);
      assert.equal(await guard(request(path, cookie)), undefined, path);
    }
  } finally {
    await dispatcher.stop();
  }

  const read = (session: string | null) =>
    handleReadPhotoshoot(request("/api/photoshoots/not-an-id", session), "not-an-id");

  const save = (session: string | null) =>
    handleSaveShot(
      request("/api/photoshoots/not-an-id/character", session, { generation_id: randomUUID() }),
      "not-an-id",
    );

  // With a session it is a photoshoot that is not there (the page says so, `reason`); without one
  // the id's shape tells nothing.
  for (const answer of [read(cookie), await save(cookie)]) {
    assert.equal(answer.status, 400);
    assert.equal((await answer.json()).reason, "not_found");
  }

  for (const answer of [read(null), await save(null)]) {
    assert.equal(answer.status, 401);
    assert.equal((await answer.json()).reason, "access_required");
  }
});

test("saving a done shot adds it to the library once; a generation of no shot is refused", async () => {
  const { cookie } = await signedIn();

  const { body } = await create(cookie, {
    character_id: maya,
    request_key: randomUUID(),
    setting: "outdoors",
  });

  const admitted = photoshootSchema.parse(body);
  const dispatcher = startDispatcher({ intervalMs: 20 });

  try {
    const done = await settle(admitted.id);
    const generationId = done.items[2]?.generation.id ?? "";
    const path = `/api/photoshoots/${done.id}/character`;
    const save = (payload: Body) => handleSaveShot(request(path, cookie, payload), done.id);

    const saved = await save({ generation_id: generationId, title: "Maya outdoors" });

    assert.equal(saved.status, 201);

    const character = characterSummarySchema.parse(await saved.json());

    assert.equal(character.origin, "generated");
    assert.equal(character.generation_id, generationId);
    assert.equal(character.title, "Maya outdoors");

    const again = await save({ generation_id: generationId });

    assert.equal(again.status, 200);
    assert.equal(characterSummarySchema.parse(await again.json()).id, character.id);

    assert.equal((await save({ generation_id: randomUUID() })).status, 404);
    assert.equal((await save({})).status, 400);
  } finally {
    await dispatcher.stop();
  }
});
