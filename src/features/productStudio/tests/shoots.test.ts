import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { findAsset, incomingPath, storeAsset } from "../../../shared/server/assets.ts";
import { fakeProvider } from "../../../shared/server/comfy-provider.fake.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { startDispatcher } from "../../../shared/server/generation/dispatcher.ts";
import { findGeneration } from "../../../shared/server/generation/generations.ts";
import { retry } from "../../../shared/server/generation/service.ts";
import type { WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import { type Shoot, shootListSchema, shootSchema } from "../contracts.ts";
import { handleCreateShoot, handleListShoots, handleReadShoot } from "../server/http.ts";
import { productShotDefinition } from "../workflows/definition.ts";
import { layouts } from "../workflows/prompts.ts";

// An answer as the tests read it: a shoot's `id`, or a refusal's `reason`.
const answerSchema = z.looseObject({ id: z.uuid().optional(), reason: z.string().optional() });

// The fake provider on a dead self-hosted port, so nothing could reach a real Comfy; shots are
// admitted `waiting` (`submitMany`) and a dispatcher started per test renders them.
Object.assign(process.env, {
  COMFY_API_KEY: "",
  COMFY_BASE_URL: "http://127.0.0.1:1",
  COMFY_FAKE_STEP_MS: "0",
  COMFY_PROVIDER: "fake",
  COMFY_PROXY_TOKEN: "",
  GENERATE_RATE_LIMIT: "1000",
  IN_FLIGHT_MAX: "4",
});

const guard = createAccessGuard({ production: false });

/** A new access code for `max` generations, its session and its `Cookie` header. */
async function newSession(max = 100) {
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

const fixture = "tests/fixtures/fake-output.png";

const fixtureSha256 = createHash("sha256")
  .update(await readFile(fixture))
  .digest("hex");

/** The product photo every shoot here renders: the fixture PNG stored as an uploaded image. */
const photo = await (async () => {
  const temporary = await incomingPath();

  await copyFile(fixture, temporary);

  const { asset } = await storeAsset(temporary, {
    bytes: (await readFile(fixture)).byteLength,
    duration_ms: null,
    ext: "png",
    fps: null,
    has_audio: null,
    height: 64,
    kind: "image",
    mime: "image/png",
    role: "upload",
    sha256: fixtureSha256,
    source_asset_id: null,
    width: 64,
  });

  return asset;
})();

const { cookie, session } = await newSession();

/** A `POST /api/product-shots` body as a client might send it, invalid ones included. */
type Body = {
  description?: string;
  format?: string;
  presets: string[];
  product: string;
  product_asset_id: string;
  request_key?: string;
};

/** A shoot request body: one product, the given presets, square unless said otherwise. */
function body(product: string, presets: string[], extra: Partial<Body> = {}): Body {
  return { presets, product, product_asset_id: photo.id, request_key: randomUUID(), ...extra };
}

/** `POST /api/product-shots` with `payload` as the session `withCookie` names (none: no session). */
async function post(payload: Body, withCookie: string | null = cookie, provider?: Provider) {
  const response = await handleCreateShoot(
    new Request("http://localhost/api/product-shots", {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json", ...(withCookie && { Cookie: withCookie }) },
      method: "POST",
    }),
    provider,
  );

  return { body: answerSchema.parse(await response.json()), status: response.status };
}

/** `GET /api/product-shots/:id` with the session. */
async function read(id: string) {
  const response = handleReadShoot(
    new Request(`http://localhost/api/product-shots/${id}`, { headers: { Cookie: cookie } }),
    id,
  );

  return shootSchema.parse(await response.json());
}

const finished = new Set(["done", "failed", "unknown", "cancelled"]);

/** Renders the waiting shots with a dispatcher on `provider` until every shot of `id` finished. */
async function render(id: string, provider: Provider = fakeProvider) {
  const dispatcher = startDispatcher({ intervalMs: 10, provider });

  try {
    const deadline = Date.now() + 20_000;
    let shoot = await read(id);

    while (!shoot.items.every(({ generation }) => finished.has(generation.status))) {
      assert.ok(Date.now() < deadline, "every shot finishes");
      await delay(10);
      shoot = await read(id);
    }

    return shoot;
  } finally {
    await dispatcher.stop();
  }
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

test("a shoot admits one shot per preset and renders each into one stored image of the product", async () => {
  const { graphs, provider } = recording();

  const admitted = await post(
    body("a green glass bottle of port wine", ["packshot", "advertising"], { format: "portrait" }),
  );

  assert.equal(admitted.status, 201);

  const shoot: Shoot = shootSchema.parse(admitted.body);

  assert.deepEqual(
    shoot.items.map(({ position, preset }) => [position, preset]),
    [
      [0, "packshot"],
      [1, "advertising"],
    ],
  );
  assert.deepEqual(
    [shoot.format, shoot.product.name],
    ["portrait", "a green glass bottle of port wine"],
  );
  assert.equal(shoot.product.image.id, photo.id);

  const done = await render(shoot.id, provider);

  for (const item of done.items) {
    assert.equal(item.generation.status, "done");
    // Published only on request (FLUX Kommunity): no share page yet.
    assert.equal(item.generation.share_slug, null);

    const image = item.generation.outputs.find(({ name }) => name === "image");

    assert.equal(image?.media, "image");
    assert.equal(image && findAsset(image.asset.id)?.sha256, fixtureSha256);

    const recipe = productShotDefinition.recipeSchema.parse(
      findGeneration(item.generation.id)?.recipe,
    );

    assert.equal(recipe.preset, item.preset);
    assert.equal(recipe.product_image_sha256, photo.sha256);
    assert.deepEqual(recipe.canvas, layouts.portrait);
    assert.match(recipe.prompt, /a green glass bottle of port wine/);
  }

  // Each graph took the uploaded photo, the prompt, the seed and the portrait canvas.
  assert.equal(graphs.length, 2);

  for (const graph of graphs) {
    assert.notEqual(graph["10"]?.inputs.image, "product.png");
    assert.match(z.string().parse(graph["4"]?.inputs.text), /port wine/);
    assert.deepEqual(
      [graph["22"]?.inputs.width, graph["22"]?.inputs.height, graph["23"]?.inputs.width],
      [896, 1152, 896],
    );
    assert.deepEqual([graph["24"]?.inputs.x, graph["21"]?.inputs.x], [160, 160]);
  }

  assert.match(
    z.string().parse(graphs[0]?.["4"]?.inputs.text),
    /^Professional e-commerce packshot/,
  );
  assert.match(z.string().parse(graphs[1]?.["4"]?.inputs.text), /^Advertising key visual/);
});

test("a scene description replaces the preset's own scene in the prompt", async () => {
  const admitted = await post(
    body("a chrome water bottle", ["lifestyle"], { description: "  a mossy rock by a river  " }),
  );

  const shoot = shootSchema.parse(admitted.body);

  const recipe = productShotDefinition.recipeSchema.parse(
    findGeneration(shoot.items[0]?.generation.id ?? "")?.recipe,
  );

  assert.equal(shoot.description, "a mossy rock by a river");
  assert.equal(recipe.description, "a mossy rock by a river");
  assert.match(recipe.prompt, /Setting: a mossy rock by a river\./);
  assert.doesNotMatch(recipe.prompt, /oak table/);
  await render(shoot.id);
});

test("a shot Comfy fails is failed provider_failed, and the shared retry renders it again in the shoot", async () => {
  const admitted = await post(body("[fake:provider_failed] a perfume bottle", ["packshot"]));
  const shoot = shootSchema.parse(admitted.body);
  const failed = await render(shoot.id);
  const first = failed.items[0]?.generation;

  assert.deepEqual([first?.status, first?.error_code], ["failed", "provider_failed"]);

  // The retry keeps the marker in the prompt, so it fails again, as the shoot's attempt 1.
  const child = await retry(first?.id ?? "", session);
  const again = await render(shoot.id);

  assert.equal(again.items[0]?.generation.id, child.id);
  assert.equal(again.items[0]?.attempt, 1);
});

test("without a session every product-shot route answers 401 and nothing is stored", async () => {
  const before = generationCount();
  const admitted = await post(body("a cosmetic tube", ["packshot"]), null);

  assert.deepEqual([admitted.status, admitted.body.reason], [401, "access_required"]);

  const list = handleListShoots(new Request("http://localhost/api/product-shots"));
  const one = handleReadShoot(new Request("http://localhost/api/product-shots/x"), randomUUID());

  assert.deepEqual([list.status, one.status], [401, 401]);
  assert.equal(generationCount(), before);
});

test("a request key answers its shoot again, refuses another code, and is required", async () => {
  const payload = body("a white cosmetic tube", ["packshot", "lifestyle"]);
  const first = await post(payload);
  const count = generationCount();
  const again = await post({ ...payload, presets: ["advertising"] });

  assert.deepEqual([first.status, again.status], [201, 200]);
  assert.equal(again.body.id, first.body.id);
  assert.equal(generationCount(), count);

  const other = await newSession();
  const conflict = await post(payload, other.cookie);

  assert.deepEqual([conflict.status, conflict.body.reason], [409, "request_key_conflict"]);
  assert.equal(other.used(), 0);

  const keyless = await post({ ...payload, request_key: undefined });

  assert.deepEqual([keyless.status, keyless.body.reason], [400, "invalid_input"]);
  assert.equal(generationCount(), count);
  await render(String(first.body.id));
});

test("a missing photo or an invalid body stores nothing", async () => {
  const before = generationCount();
  const missing = await post({ ...body("a bottle", ["packshot"]), product_asset_id: randomUUID() });
  const repeated = await post(body("a bottle", ["packshot", "packshot"]));
  const blank = await post(body(" ", ["packshot"]));

  assert.deepEqual([missing.status, missing.body.reason], [404, "not_found"]);
  assert.deepEqual(
    [repeated.status, blank.status, repeated.body.reason],
    [400, 400, "invalid_input"],
  );
  assert.equal(generationCount(), before);
});

test("the list names the workspace's shoots with their shots' statuses, newest first", async () => {
  const shoot = shootSchema.parse((await post(body("a listed bottle", ["advertising"]))).body);

  const response = handleListShoots(
    new Request("http://localhost/api/product-shots", { headers: { Cookie: cookie } }),
  );

  const { shoots } = shootListSchema.parse(await response.json());

  assert.equal(shoots[0]?.id, shoot.id);
  assert.deepEqual(shoots[0]?.presets, ["advertising"]);
  assert.deepEqual(shoots[0]?.statuses, ["waiting"]);
  await render(shoot.id);
});
