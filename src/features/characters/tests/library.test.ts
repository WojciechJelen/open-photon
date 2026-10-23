import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { database } from "../../../shared/server/db.server.ts";
import {
  CharacterError,
  createFromUpload,
  getCharacter,
  listCharacters,
  renameCharacter,
  setFavorite,
  visibleCharacter,
} from "../api.ts";
import { generatedCharacter, sampleCharacter, uploadedCharacter } from "./fixtures.ts";

/** Asserts that `operation` throws a `CharacterError` with this status and reason. */
function assertRefused(operation: () => void, status: number, reason: string) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof CharacterError);
    assert.deepEqual([error.status, error.reason], [status, reason]);

    return true;
  });
}

test("an upload with consent becomes one character per image; anything but a stored image is refused", async () => {
  const character = await uploadedCharacter("Me on the roof");

  assert.equal(character.origin, "upload");
  assert.equal(character.is_sample, false);
  assert.equal(character.title, "Me on the roof");
  assert.ok(Date.parse(character.consent_at ?? ""));
  assert.equal(character.image.id, character.image_asset_id);
  assert.deepEqual(
    [character.favorite_at, character.updated_at, character.provenance, character.prompt],
    [null, null, null, null],
  );

  // The same image again: the stored character, as it is.
  const again = createFromUpload({
    assetId: character.image_asset_id,
    consentAt: new Date().toISOString(),
    title: "Another title",
  });

  assert.deepEqual(again, { character, created: false });

  const clip = z
    .object({ id: z.string() })
    .parse(database.prepare("SELECT id FROM assets WHERE kind = 'video' LIMIT 1").get()).id;

  for (const assetId of [clip, crypto.randomUUID()]) {
    assertRefused(
      () => createFromUpload({ assetId, consentAt: new Date().toISOString() }),
      422,
      "not_image",
    );
  }

  assertRefused(
    () =>
      createFromUpload({
        assetId: character.image_asset_id,
        consentAt: new Date().toISOString(),
        title: " ",
      }),
    422,
    "invalid_title",
  );
});

test("a character is renamed with a trimmed title of 1–80 characters; a sample keeps its own", async () => {
  const character = await uploadedCharacter();
  const renamed = renameCharacter(character.id, "  Stage name  ");

  assert.equal(renamed.title, "Stage name");
  assert.ok(renamed.updated_at && renamed.updated_at >= character.created_at);
  assert.deepEqual(getCharacter(character.id), renamed);

  for (const title of ["", "   ", "x".repeat(81)]) {
    assertRefused(() => renameCharacter(character.id, title), 422, "invalid_title");
  }

  assertRefused(() => renameCharacter(sampleCharacter().id, "Mine now"), 409, "sample");
  assertRefused(() => renameCharacter(crypto.randomUUID(), "Nobody"), 404, "not_found");
  assert.equal(getCharacter(character.id)?.title, "Stage name");
  assert.equal(sampleCharacter().title, "Arthur");
});

test("a favorite keeps the time it was first marked until it is unmarked; samples can be favorites", async () => {
  const character = await generatedCharacter();
  const marked = setFavorite(character.id, true);

  assert.ok(marked.favorite_at && marked.updated_at);
  assert.equal(setFavorite(character.id, true).favorite_at, marked.favorite_at);

  const unmarked = setFavorite(character.id, false);

  assert.equal(unmarked.favorite_at, null);
  assert.equal(getCharacter(character.id)?.favorite_at, null);

  const sample = sampleCharacter("kenji");

  assert.ok(setFavorite(sample.id, true).favorite_at);
  assert.equal(setFavorite(sample.id, false).favorite_at, null);
  assertRefused(() => setFavorite(crypto.randomUUID(), true), 404, "not_found");
});

test("the library lists the workspace's characters, the newest first, a favorite too; samples only on request", async () => {
  const older = await uploadedCharacter("Older");
  const newer = await generatedCharacter("A newer one");
  const favorite = await uploadedCharacter("Favorite");

  // Apart by a second each, whatever the clock's resolution.
  for (const [index, { id }] of [older, newer, favorite].entries()) {
    database
      .prepare("UPDATE characters SET created_at = ? WHERE id = ?")
      .run(`2099-01-01T00:00:0${index}.000Z`, id);
  }

  setFavorite(older.id, true);

  const library = listCharacters({ includeSamples: false }).map(({ id }) => id);

  assert.ok(listCharacters({ includeSamples: false }).every(({ is_sample }) => !is_sample));
  assert.deepEqual(library.slice(0, 3), [favorite.id, newer.id, older.id]);
  assert.deepEqual(
    listCharacters({ favorites: true, includeSamples: false }).map(({ id }) => id),
    [older.id],
  );
  assert.deepEqual(
    listCharacters({ includeSamples: false, query: "NEWER" }).map(({ id }) => id),
    [newer.id],
  );

  const all = listCharacters({ includeSamples: true });

  assert.deepEqual(
    all.filter(({ is_sample }) => !is_sample).map(({ id }) => id),
    library,
  );
  assert.deepEqual(
    new Set(all.filter(({ is_sample }) => is_sample).map(({ title }) => title)),
    new Set(["Arthur", "Kenji", "Maya", "Rosa", "Theo", "Yuki"]),
  );

  setFavorite(older.id, false);
});

test("without a session, a page shows a sample or a shared generation's character, never an uploaded likeness", async () => {
  const upload = await uploadedCharacter();
  const generated = await generatedCharacter();
  const sample = sampleCharacter();

  assert.equal(visibleCharacter(upload, false), null);
  assert.deepEqual(visibleCharacter(sample, false), sample);
  // The test workflow publishes a done generation on done, which opens its outputs.
  assert.deepEqual(visibleCharacter(generated, false), generated);

  for (const character of [upload, generated, sample]) {
    assert.deepEqual(visibleCharacter(character, true), character);
  }

  assert.equal(visibleCharacter(null, true), null);
});
