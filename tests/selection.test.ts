import "./temp-database.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { listSampleCharacters } from "../src/features/characters/api.ts";
import { listLibrary } from "../src/features/characters/server/http.ts";
import { uploadedCharacter } from "../src/features/characters/tests/fixtures.ts";
import { readSelection, readStudio } from "../src/features/motionTransfer/server/selection.ts";

const library = async () => {
  const answer = await listLibrary(new Request("https://preview.example/api/characters")).json();

  return answer.characters;
};

test("with a session, the page brings the library exactly as the picker's own read answers it", async () => {
  const uploaded = await uploadedCharacter();
  const selection = readSelection({}, true);

  assert.deepEqual(
    JSON.parse(JSON.stringify(selection.characters)),
    await library(),
    "the same characters, in the same order, with the same fields",
  );
  assert.ok(selection.characters.some(({ id }) => id === uploaded.id));
  assert.ok(selection.characters.some(({ is_sample }) => is_sample));
});

test("without a session, nothing of an upload reaches the answer, even when the URL names it", async () => {
  const uploaded = await uploadedCharacter();

  for (const search of [{}, { character: uploaded.id }]) {
    const selection = readSelection(search, false);

    assert.deepEqual(selection.characters, listSampleCharacters());
    assert.ok(selection.characters.every(({ is_sample }) => is_sample));
    assert.equal(selection.character, null);

    const { characterId, ...rest } = selection;
    const answer = JSON.stringify(rest);

    assert.ok(!answer.includes(uploaded.id), "not the character's id");
    assert.ok(!answer.includes(uploaded.image.id), "not its image");
    // The URL's own id comes back, so Generate can send it once the code is in; nothing more.
    assert.ok(characterId === null || characterId === uploaded.id);
  }
});

test("the samples stay the samples, by title, with or without a session", async () => {
  await uploadedCharacter();

  const titles = listSampleCharacters().map(({ title }) => title);

  for (const signedIn of [true, false]) {
    const { samples } = readSelection({}, signedIn);

    assert.ok(samples.every(({ is_sample }) => is_sample));
    assert.deepEqual(
      samples.map(({ title }) => title),
      titles,
    );
    assert.deepEqual(
      samples.map(({ title }) => title),
      [...titles].sort((one, other) => (one ?? "").localeCompare(other ?? "")),
    );
  }

  assert.ok(readStudio().characters.every(({ is_sample }) => is_sample));
});
