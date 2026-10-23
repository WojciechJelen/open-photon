// BASE_URL=http://127.0.0.1:<port> ACCESS_CODE=<code> node scripts/prerender-samples.mjs
//
// Renders the sample matrix: every sample motion × every sample character, through the running
// server's `POST /api/generate` with the defaults (no prompt, no seed: `workflows/defaults.json`'s
// neutral prompt and seed 20261019), one at a time, waiting for each to be `done`, then marks each
// done take pre-rendered (`is_prerendered = 1`): its page, API and result become public, the
// studio home's result wall shows it, and the wizard's sample × sample pick lands on it without a
// submit or a session.
//
// - The server at BASE_URL renders; ACCESS_CODE (scripts/mint-code.mjs on that server's database,
//   max generations ≥ motions × characters) pays. Its database (DATABASE_PATH, default
//   data/app.sqlite) is where the flag is written, with node:sqlite, beside the running server
//   (WAL; `busy_timeout`), like mint-code.mjs. There is no HTTP endpoint for the flag: every access
//   code may do what every other may, so an endpoint would let any code holder publish any take.
// - Idempotent: generate reuses a done (or in-flight) generation of the same recipe, so a second
//   run submits nothing and sets nothing new.
// - A take is marked only once it is done with its side-by-side (`compare`) output. One that fails
//   is reported and left; the script exits 1 after trying the rest.
// - It refuses a BASE_URL on port 3030 (a local container with a real key; CHECKLIST.md, Phase 1)
//   unless ALLOW_3030=1.
// - Self-contained (no repository sources), so the app image ships it beside mint-code.mjs: on a
//   deployment, run it in the container (`railway ssh`) against http://127.0.0.1:$PORT.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";

const POLL_MS = 3000;
// A Cloud take is about 65 s plus its queue; a self-host one several minutes.
const TAKE_TIMEOUT_MS = 30 * 60 * 1000;
const TERMINAL = new Set(["done", "failed", "unknown", "cancelled"]);

const base = process.env.BASE_URL?.replace(/\/+$/, "");
const code = process.env.ACCESS_CODE;

if (!base || !code) {
  console.error(
    "Usage: BASE_URL=http://127.0.0.1:<port> ACCESS_CODE=<code> [DATABASE_PATH=data/app.sqlite] node scripts/prerender-samples.mjs",
  );
  process.exit(2);
}

if (new URL(base).port === "3030" && process.env.ALLOW_3030 !== "1") {
  console.error(
    `Refusing ${base}: port 3030 is the local container with a real key. Set ALLOW_3030=1 if you mean it.`,
  );
  process.exit(2);
}

const path = resolve(process.env.DATABASE_PATH ?? "data/app.sqlite");

if (!existsSync(path)) {
  console.error(`No database at ${path}. Set DATABASE_PATH to the database of ${base}'s server.`);
  process.exit(1);
}

const database = new DatabaseSync(path);
database.exec("PRAGMA busy_timeout = 5000");

/** A JSON request to the server, with the session cookie once signed in. */
async function call(pathname, { body, cookie } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    method: body === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();

  return { headers: response.headers, json: text ? JSON.parse(text) : null, status: response.status };
}

/** Signs in with ACCESS_CODE and returns the session cookie. */
async function signIn() {
  const response = await fetch(`${base}/api/session`, {
    body: JSON.stringify({ code }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });

  assert.equal(response.status, 204, `Signing in at ${base} with ACCESS_CODE failed`);
  const cookie = response.headers.get("Set-Cookie");
  assert.ok(cookie, "Signing in must issue a session cookie");

  return cookie.split(";")[0];
}

/**
 * Asks for the take of `motion` × `character` at the defaults; waits out a rate limit or a full
 * queue. Returns the generation id and whether an existing one was reused.
 */
async function requestTake(cookie, motion, character) {
  for (;;) {
    const { headers, json, status } = await call("/api/generate", {
      body: { character_id: character.id, motion_asset_id: motion.source_asset_id },
      cookie,
    });

    if (status === 200 || status === 201 || status === 202) {
      return { id: json.id, reused: json.reused === true };
    }

    if (status === 429 || status === 503) {
      const seconds = Number(json?.retry_after ?? headers.get("Retry-After") ?? 30);
      console.log(`  ${json?.reason ?? status}: trying again in ${seconds} s`);
      await sleep((seconds + 1) * 1000);
      continue;
    }

    throw new Error(`POST /api/generate answered ${status}: ${JSON.stringify(json)}`);
  }
}

/** Polls the generation until it ends; its last snapshot. */
async function waitForEnd(cookie, id) {
  const deadline = Date.now() + TAKE_TIMEOUT_MS;
  let last = "";

  for (;;) {
    const { json, status } = await call(`/api/generations/${id}`, { cookie });

    assert.equal(status, 200, `GET /api/generations/${id} answered ${status}`);

    if (TERMINAL.has(json.status)) {
      return json;
    }

    if (json.status !== last) {
      last = json.status;
      console.log(`  ${id}: ${last}${json.position ? ` (place ${json.position})` : ""}`);
    }

    if (Date.now() > deadline) {
      throw new Error(`${id} is still ${json.status} after ${TAKE_TIMEOUT_MS / 60_000} min`);
    }

    await sleep(POLL_MS);
  }
}

try {
  const motions = database.prepare("SELECT title, source_asset_id FROM motions ORDER BY title").all();
  const characters = database
    .prepare("SELECT id, title FROM characters WHERE is_sample = 1 ORDER BY title")
    .all();

  assert.ok(motions.length > 0 && characters.length > 0, `${path} has no sample motions or characters`);
  console.log(
    `${motions.length} motions × ${characters.length} characters = ${motions.length * characters.length} takes, on ${base}`,
  );

  const cookie = await signIn();
  const failures = [];
  let submitted = 0;

  for (const motion of motions) {
    for (const character of characters) {
      const label = `${motion.title} × ${character.title}`;
      const { id, reused } = await requestTake(cookie, motion, character);
      submitted += reused ? 0 : 1;
      console.log(`${label}: ${id} (${reused ? "reused" : "submitted"})`);

      const snapshot = await waitForEnd(cookie, id);
      const outputs = new Set((snapshot.outputs ?? []).map(({ name }) => name));

      if (snapshot.status !== "done" || !outputs.has("video") || !outputs.has("compare")) {
        failures.push(label);
        console.error(
          `  ${id}: ${snapshot.status}, outputs [${[...outputs].join(", ")}]; not marked pre-rendered`,
        );
        continue;
      }

      const { changes } = database
        .prepare(
          `UPDATE generations SET is_prerendered = 1
          WHERE id = ? AND status = 'done' AND workflow_id = 'motion-transfer'`,
        )
        .run(id);
      const row = database.prepare("SELECT share_slug FROM generations WHERE id = ?").get(id);

      assert.ok(
        changes === 1 && row,
        `${path} has no done generation ${id}: is DATABASE_PATH the database of ${base}'s server?`,
      );
      console.log(`  pre-rendered: ${base}/g/${id} · ${base}/r/${row.share_slug}`);
    }
  }

  console.log(`${submitted} submitted, ${failures.length} failed`);

  if (failures.length > 0) {
    console.error(`Not pre-rendered: ${failures.join("; ")}`);
    process.exitCode = 1;
  }
} finally {
  database.close();
}
