import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { database } from "../../../shared/server/db.server.ts";
import { characterSummarySchema } from "../contracts.ts";
import { listLibrary } from "../server/http.ts";
import { setFavorite } from "../server/repository.ts";
import { generatedCharacter, sampleCharacter, uploadedCharacter } from "./fixtures.ts";

const origin = "http://localhost";
const librarySchema = z.object({ characters: z.array(characterSummarySchema) }).strict();

/** `GET /api/characters` with `query`, as the handler answers it: its status and body. */
async function list(query = "") {
  const response = listLibrary(new Request(`${origin}/api/characters${query}`));

  return { body: await response.json(), response };
}

/** The ids `GET /api/characters?<query>` answers with, in its order. */
async function ids(query = "") {
  const { body, response } = await list(query);

  assert.equal(response.status, 200, JSON.stringify(body));

  return librarySchema.parse(body).characters.map(({ id }) => id);
}

/** Stores `created_at` for `id`, so the order does not hang on the clock's resolution. */
function createdAt(id: string, at: string) {
  database.prepare("UPDATE characters SET created_at = ? WHERE id = ?").run(at, id);
}

// One library for every test below, made once: an upload, a generated character, a renamed
// upload, from the oldest to the newest, after the samples (seeded earlier).
const older = await uploadedCharacter("Rooftop Runner");
const generated = await generatedCharacter("A painter in a YELLOW raincoat");
const newest = await uploadedCharacter("Ballet Teacher");

createdAt(older.id, "2099-01-01T00:00:01.000Z");

createdAt(generated.id, "2099-01-01T00:00:02.000Z");

createdAt(newest.id, "2099-01-01T00:00:03.000Z");

const samples = ["placeholder-blue", "placeholder-green", "placeholder-orange"].map((slug) =>
  sampleCharacter(slug),
);

test("GET /api/characters lists the workspace and the samples, most recent first, ties by id", async () => {
  const all = await ids();

  assert.deepEqual(all.slice(0, 3), [newest.id, generated.id, older.id]);
  assert.deepEqual(
    new Set(all.slice(3)),
    new Set(samples.map(({ id }) => id)),
    "the samples, seeded before anything was uploaded, come last",
  );

  // Two characters made in the same instant: the greater id first.
  const twin = await uploadedCharacter("Twin");

  createdAt(twin.id, "2099-01-01T00:00:03.000Z");

  const [first, second] = newest.id > twin.id ? [newest.id, twin.id] : [twin.id, newest.id];

  assert.deepEqual((await ids()).slice(0, 2), [first, second]);
  createdAt(twin.id, "2000-01-01T00:00:00.000Z");

  const { body } = await list();

  assert.deepEqual(
    librarySchema.parse(body).characters.find(({ id }) => id === generated.id),
    { ...generated, created_at: "2099-01-01T00:00:02.000Z" },
    "each entry is the full character summary, provenance included",
  );
});

test("GET /api/characters?samples=0 leaves the samples out", async () => {
  const workspace = await ids("?samples=0");

  assert.ok(workspace.length >= 3);
  assert.ok(!workspace.some((id) => samples.some((sample) => sample.id === id)));
  assert.deepEqual(
    await ids("?samples=1"),
    await ids(),
    "samples=1 is the default, everything is listed",
  );
});

test("GET /api/characters?q= finds a case-insensitive part of the title or the prompt", async () => {
  assert.deepEqual(await ids("?q=ballet"), [newest.id]);
  assert.deepEqual(await ids("?q=%20RUNNER%20"), [older.id], "trimmed, any letter case");
  assert.deepEqual(await ids("?q=yellow%20rain"), [generated.id], "the prompt counts too");
  assert.deepEqual(await ids("?q=placeholder%20GREEN"), [sampleCharacter("placeholder-green").id]);
  assert.deepEqual(await ids("?q=placeholder&samples=0"), []);
  assert.deepEqual(await ids("?q=nobody-has-this"), []);
  assert.deepEqual(await ids("?q=%25"), [], "a % is a character, not a wildcard");
  assert.deepEqual(await ids("?q="), await ids(), "a blank query lists everything");
});

test("GET /api/characters?favorites=1 lists only the favorites, still most recent first", async () => {
  const sample = sampleCharacter("placeholder-orange");

  setFavorite(older.id, true);
  setFavorite(newest.id, true);
  setFavorite(sample.id, true);

  try {
    assert.deepEqual(await ids("?favorites=1"), [newest.id, older.id, sample.id]);
    assert.deepEqual(await ids("?favorites=1&samples=0"), [newest.id, older.id]);
    assert.deepEqual(await ids("?favorites=1&q=runner"), [older.id]);
    assert.ok((await ids("?favorites=0")).includes(generated.id));
  } finally {
    for (const { id } of [older, newest, sample]) {
      setFavorite(id, false);
    }
  }

  assert.deepEqual(await ids("?favorites=1"), []);
});

test("GET /api/characters refuses a query it does not understand", async () => {
  for (const query of ["?favorites=yes", "?samples=true", `?q=${"x".repeat(201)}`]) {
    const { body, response } = await list(query);

    assert.equal(response.status, 400, query);
    assert.equal(typeof body.error, "string");
  }
});

test("GET /api/characters needs a session; the /characters page opens without one", async () => {
  const guard = createAccessGuard({ production: true });

  const anonymous = await guard(new Request(`${origin}/api/characters`));

  assert.ok(anonymous);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).reason, "access_required");

  for (const path of ["/api/characters?samples=1", "/API/Characters/"]) {
    assert.equal((await guard(new Request(`${origin}${path}`)))?.status, 401, path);
  }

  const login = await guard(
    new Request(`${origin}/api/session`, {
      body: JSON.stringify({ code: mintCode(5) }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  const cookie = login?.headers.get("Set-Cookie")?.split(";")[0] ?? "";

  assert.equal(
    await guard(new Request(`${origin}/api/characters`, { headers: { Cookie: cookie } })),
    undefined,
  );

  // The page itself explains the access code to a visitor without one.
  assert.equal(
    await guard(new Request(`${origin}/characters`, { headers: { Accept: "text/html" } })),
    undefined,
  );
});
