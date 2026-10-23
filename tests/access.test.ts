import "./temp-database.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, stat } from "node:fs/promises";
import { test } from "node:test";

import { motionTransferDefinition } from "../src/features/motionTransfer/workflows/definition.ts";
import {
  createAccessGuard,
  readSession,
  serverFnRefusal,
  uploadRefusal,
} from "../src/shared/server/access.server.ts";
import { hashFile, incomingPath, storeAsset } from "../src/shared/server/assets.ts";
import { database } from "../src/shared/server/db.server.ts";
import { createGeneration, markQueued } from "../src/shared/server/generation/generations.ts";
import { mintCode } from "./temp-database.ts";

// The rows here are Motion Transfer's, on Comfy Cloud.
const cloud = { kind: "cloud", origin: null } as const;

const origin = "https://preview.example";

/** `POST /api/session` with `{ code }`. */
function exchange(code: string) {
  return new Request(`${origin}/api/session`, {
    body: JSON.stringify({ code }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

/** The `/access` form's post, returning to `path`'s `next`. */
function login(code: string, path = "/access") {
  return new Request(`${origin}${path}`, { body: new URLSearchParams({ code }), method: "POST" });
}

/** The `name=value` part of a session cookie the guard set for `code`. */
async function sessionCookie(code: string) {
  const response = await createAccessGuard({ production: true })(exchange(code));

  return response?.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

test("a minted code is printed once and stored only as its SHA-256", () => {
  const code = mintCode(50);

  const row = database
    .prepare("SELECT * FROM access_codes WHERE code_hash = ?")
    .get(createHash("sha256").update(code).digest("hex"));

  assert.match(code, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(row?.label, "test");
  assert.equal(row?.max_generations, 50);
  assert.equal(row?.used, 0);
  assert.notEqual(mintCode(50), code);

  // Nothing stored is the plain code. (Not checked by reading the database file: closing a file
  // descriptor drops this process's POSIX locks on it, SQLite's included.)
  assert.ok(!Object.values(row ?? {}).some((value) => String(value).includes(code)));

  const usage = spawnSync(process.execPath, ["scripts/mint-code.mjs", "judges"], {
    encoding: "utf8",
  });

  assert.equal(usage.status, 2);
  assert.equal(usage.stdout, "");
});

test("POST /api/session exchanges a code for an HttpOnly cookie; anything else is a 401", async () => {
  const code = mintCode(5);
  const guard = createAccessGuard({ production: true });
  const response = await guard(exchange(code));
  const header = response?.headers.get("Set-Cookie") ?? "";

  assert.equal(response?.status, 204);

  for (const flag of ["HttpOnly", "SameSite=Lax", "Secure", "Max-Age=43200", "Path=/"]) {
    assert.ok(header.includes(flag), flag);
  }

  assert.ok(!header.includes(code));

  for (const body of [
    exchange(`${code}x`),
    exchange(""),
    new Request(`${origin}/api/session`, { method: "POST" }),
  ]) {
    const refused = await guard(body);

    assert.equal(refused?.status, 401);
    assert.equal((await refused?.json())?.reason, "invalid_code");
  }

  // Development over plain HTTP: the same cookie without `Secure`.
  const local = await createAccessGuard({ production: false })(
    new Request("http://127.0.0.1:3031/api/session", {
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  assert.equal(local?.status, 204);
  assert.ok(!local?.headers.get("Set-Cookie")?.includes("Secure"));
});

test("a session is bound to its code: it survives a restart, not tampering, expiry or revocation", async () => {
  const code = mintCode(5);
  const cookie = await sessionCookie(code);

  const codeId = String(
    database
      .prepare("SELECT id FROM access_codes WHERE code_hash = ?")
      .get(createHash("sha256").update(code).digest("hex"))?.id,
  );

  const request = (value = cookie) =>
    new Request(`${origin}/api/uploads`, { headers: { Cookie: value }, method: "POST" });

  // A new guard (a restarted server) knows it: it is signed with the stored hash, not a secret.
  assert.deepEqual(readSession(request()), { codeId });
  assert.equal(await createAccessGuard({ production: true })(request()), undefined);
  assert.equal(readSession(request(`${cookie}0`)), null);
  assert.equal(readSession(request(cookie.replace(/\.\d{13}\./, ".9999999999999."))), null);
  assert.equal(
    readSession(request(), () => Date.now() + 12 * 60 * 60 * 1000),
    null,
  );

  database
    .prepare("UPDATE access_codes SET revoked_at = ? WHERE id = ?")
    .run(new Date().toISOString(), codeId);

  assert.equal(readSession(request()), null);
  assert.equal((await createAccessGuard({ production: true })(exchange(code)))?.status, 401);
});

test("the /access form signs in and returns to the page asked for, on this site only", async () => {
  const code = mintCode(5);
  const guard = createAccessGuard({ production: true });

  const redirect = await guard(
    new Request(`${origin}/g/${crypto.randomUUID()}?x=1`, { headers: { Accept: "text/html" } }),
  );

  const access = redirect?.headers.get("Location") ?? "";
  const asked = decodeURIComponent(access.replace("/access?next=", ""));

  assert.match(access, /^\/access\?next=%2Fg%2F/);
  assert.ok((await (await guard(new Request(`${origin}${access}`)))?.text())?.includes(access));
  assert.equal((await guard(login("wrong", access)))?.status, 401);
  assert.equal((await guard(login(code, access)))?.headers.get("Location"), asked);

  for (const next of ["//evil.example/", "/\\evil.example", "https://evil.example/", "x"]) {
    const path = `/access?next=${encodeURIComponent(next)}`;
    assert.equal((await guard(login(code, path)))?.headers.get("Location"), "/");
  }
});

test("wrong codes are limited per client and across the instance; one client cannot lock out another", async () => {
  process.env.CLIENT_IP_HEADER = "X-Real-IP";

  try {
    const code = mintCode(5);
    let time = Date.now();
    const guard = createAccessGuard({ production: true }, () => time);

    const from = (client: string, request: Request) => {
      request.headers.set("X-Real-IP", client);

      return guard(request);
    };

    // Ten wrong codes from one client, both kinds of login: its next attempt is refused.
    assert.equal((await from("10.2.0.1", login("x".repeat(5000))))?.status, 401);

    for (let attempt = 0; attempt < 9; attempt++) {
      assert.equal((await from("10.2.0.1", exchange("wrong")))?.status, 401);
    }

    const limited = await from("10.2.0.1", exchange(code));

    assert.equal(limited?.status, 429);
    assert.equal((await limited?.json())?.reason, "rate_limited");
    assert.equal((await from("10.2.0.1", login(code)))?.status, 429);

    // Another client still signs in, and a right code costs nothing.
    for (let attempt = 0; attempt < 12; attempt++) {
      assert.equal((await from("10.2.0.2", exchange(code)))?.status, 204);
    }

    // The exhausted client again once its `Retry-After` has passed.
    time += Number(limited?.headers.get("Retry-After")) * 1000;
    assert.equal((await from("10.2.0.1", exchange(code)))?.status, 204);

    // 300 wrong codes a minute from many clients: then every login waits, a right code included.
    time += 60_000;

    for (let client = 0; client < 300; client++) {
      assert.equal(
        (await from(`10.3.${client >> 8}.${client & 255}`, exchange("wrong")))?.status,
        401,
      );
    }

    assert.equal((await from("10.4.0.1", exchange(code)))?.status, 429);
    time += 60_000;
    assert.equal((await from("10.4.0.1", exchange(code)))?.status, 204);
  } finally {
    delete process.env.CLIENT_IP_HEADER;
  }
});

test("server functions need a session unless they are on the public list", async () => {
  const cookie = await sessionCookie(mintCode(5));

  const call = (filename: string, name: string, headers?: HeadersInit) =>
    serverFnRefusal(new Request(`${origin}/_serverFn/any`, { headers }), { filename, name });

  const unlisted = call("src/lib/admin.functions.ts", "loadEverything");

  assert.equal(unlisted?.status, 401);
  assert.equal((await unlisted?.json())?.reason, "access_required");
  // A public name in another file is another function.
  assert.equal(
    call("src/features/motionTransfer/selection.functions.ts", "loadShare")?.status,
    401,
  );
  assert.equal(call("src/lib/admin.functions.ts", "loadEverything", { Cookie: cookie }), undefined);

  for (const [filename, name] of [
    ["src/features/motionTransfer/selection.functions.ts", "loadSelection"],
    ["src/features/motionTransfer/selection.functions.ts", "loadStudio"],
    ["src/features/motionTransfer/generate.functions.ts", "loadShare"],
    ["src/features/motionTransfer/generate.functions.ts", "loadResult"],
  ] as const) {
    assert.equal(call(filename, name), undefined);
  }
});

test("uploads, cuts and character photos are limited to 10 a minute per code and per client, then 429 with Retry-After", async () => {
  process.env.CLIENT_IP_HEADER = "X-Real-IP";

  try {
    const spent = await sessionCookie(mintCode(5));
    const busy = await sessionCookie(mintCode(5));
    const fresh = await sessionCookie(mintCode(5));
    // From after the logins: a session that expires more than 12 hours ahead is no session.
    let time = Date.now();

    // The handlers call it whatever URL brought the request (`tests/access.spec.ts` sends some).
    const post = (cookie: string, client: string) =>
      uploadRefusal(
        new Request(`${origin}/api/uploads`, {
          headers: { Cookie: cookie, "X-Real-IP": client },
          method: "POST",
        }),
        () => time,
      );

    // One code from ten clients: its eleventh, from yet another client, is refused.
    for (let index = 0; index < 10; index++) {
      assert.equal(post(spent, `10.0.0.${index}`), undefined);
    }

    const limited = post(spent, "10.0.0.99");
    const body = await limited?.json();

    assert.equal(limited?.status, 429);
    assert.equal(body?.reason, "rate_limited");
    assert.equal(limited?.headers.get("Retry-After"), String(body?.retry_after));

    // One client with one code ten times: another code from that client is refused too.
    for (let index = 0; index < 10; index++) {
      assert.equal(post(busy, "10.0.1.1"), undefined);
    }

    assert.equal(post(fresh, "10.0.1.1")?.status, 429);
    assert.equal(post(fresh, "10.0.1.2"), undefined);

    // A token is back once `Retry-After` has passed.
    time += Number(body?.retry_after) * 1000;
    assert.equal(post(spent, "10.0.0.99"), undefined);
  } finally {
    delete process.env.CLIENT_IP_HEADER;
  }
});

test("without a session: the picker, samples, share pages and pre-rendered samples are open; uploads, generations and other media are not", async () => {
  const guard = createAccessGuard({ production: true });
  const cookie = await sessionCookie(mintCode(5));

  const sampleImage = String(
    database.prepare("SELECT image_asset_id FROM characters WHERE is_sample = 1").get()
      ?.image_asset_id,
  );

  const temporary = await incomingPath();
  await copyFile("fixtures/x.mp4", temporary);

  const { asset: upload } = await storeAsset(temporary, {
    bytes: (await stat(temporary)).size,
    duration_ms: null,
    ext: "mp4",
    fps: null,
    has_audio: null,
    height: null,
    kind: "video",
    mime: "video/mp4",
    role: "upload",
    sha256: await hashFile(temporary),
    source_asset_id: null,
    width: null,
  });

  /** A queued generation; `prerendered` marks it as a pre-rendered sample (Step 9.2). */
  const generation = (seed: number, prerendered: boolean) => {
    const { id } = createGeneration(motionTransferDefinition, {
      recipe: {
        inputs: { driving_video_sha256: upload.sha256, reference_image_sha256: upload.sha256 },
        models: [],
        params: { fragment_length: 81, height: 848, prompt: "A dancer", seed, width: 480 },
        target: "cloud",
        workflow: { id: "motion-transfer", sha256: upload.sha256, version: 1 },
      },
      target: cloud,
    });

    markQueued(id, `job-${id}`);
    database
      .prepare("UPDATE generations SET is_prerendered = ? WHERE id = ?")
      .run(Number(prerendered), id);

    return id;
  };

  const sample = generation(1, true);
  const private_ = generation(2, false);

  const ask = (method: string, path: string, headers: HeadersInit = {}) =>
    guard(new Request(`${origin}${path}`, { headers, method }));

  const open = [
    ["GET", "/"],
    ["GET", "/?motion=x"],
    ["GET", "/motionTransfer"],
    ["GET", "/motionTransfer?step=direct&motion=x"],
    ["GET", "/r/0123456789abcdef"],
    ["GET", `/media/${sampleImage}.png`],
    ["HEAD", `/media/${sampleImage}.png`],
    ["GET", `/g/${sample}`],
    ["GET", `/api/generations/${sample}`],
    ["GET", `/api/generations/${sample}/events`],
    ["GET", `/api/generations/${sample}/recipe.json`],
    // Their handlers decide: only a result that exists already is free (tests/generate.test.ts).
    ["POST", "/api/generate"],
    ["POST", `/api/generations/${private_}/rerun`],
    ["POST", "/_serverFn/example"],
    // Aliases the router sends to the same routes: any letter case, a trailing slash.
    ["GET", "/MotionTransfer/"],
    ["GET", "/R/0123456789abcdef/"],
    ["GET", `/Media/${sampleImage}.png/`],
    ["GET", `/API/Generations/${sample}/Events/`],
  ];

  const closed = [
    ["POST", "/api/uploads"],
    ["POST", "/api/characters"],
    ["POST", `/api/assets/${upload.id}/trim`],
    ["POST", `/api/generations/${private_}/retry`],
    ["POST", `/api/generations/${sample}/retry`],
    ["POST", "/"],
    ["POST", "/motionTransfer"],
    ["GET", "/motionTransfer/x"],
    ["GET", `/media/${upload.id}.mp4`],
    ["GET", `/media/${crypto.randomUUID()}.mp4`],
    ["GET", `/api/generations/${private_}`],
    ["GET", `/api/generations/${private_}/events`],
    ["GET", `/api/generations/${private_}/recipe.json`],
    ["GET", "/api/debug/streams"],
    // Aliases of the closed ones, and an id in other letters (the router passes ids on as given).
    ["POST", "/API/Uploads/"],
    ["GET", `/Api/Generations/${private_}/Events/`],
    ["GET", `/g/${sample.toUpperCase()}`],
  ];

  for (const [method = "", path = ""] of open) {
    assert.equal(await ask(method, path), undefined, `${method} ${path}`);
  }

  for (const [method = "", path = ""] of closed) {
    const response = await ask(method, path);

    assert.equal(response?.status, 401, `${method} ${path}`);
    assert.equal((await response?.json())?.reason, "access_required");
  }

  // A page that needs a session asks for the code first, then comes back to it.
  const page = await ask("GET", `/g/${private_}`, { Accept: "text/html" });

  assert.equal(page?.status, 303);
  assert.equal(
    page?.headers.get("Location"),
    `/access?next=${encodeURIComponent(`/g/${private_}`)}`,
  );

  // With a session, every one of them goes on to its route.
  for (const [method = "", path = ""] of [...open, ...closed]) {
    assert.equal(await ask(method, path, { Cookie: cookie }), undefined, `${method} ${path}`);
  }
});
