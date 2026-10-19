import "./temp-database.ts";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";

import { uploadCharacter } from "../src/server/characters.server.ts";
import { database } from "../src/server/db.server.ts";
import { assetsDirectory } from "../src/server/paths.ts";

function upload(path: string, consent?: string) {
  const form = new FormData();
  form.append("image", new Blob([readFileSync(path)]), basename(path));

  if (consent !== undefined) {
    form.append("consent", consent);
  }

  return uploadCharacter(
    new Request("http://localhost/api/characters", { body: form, method: "POST" }),
  );
}

function count(sql: string) {
  return Number(database.prepare(`SELECT count(*) AS count FROM ${sql}`).get()?.count);
}

test("an uploaded character needs consent and a real image; nothing is stored otherwise", async () => {
  const files = readdirSync(assetsDirectory());
  const assets = count("assets");

  for (const [path, consent, reason] of [
    ["fixtures/wan/reference.png", undefined, "consent_required"],
    ["fixtures/wan/reference.png", "false", "consent_required"],
    ["fixtures/x.mp4", "true", "not_image"],
  ]) {
    const response = await upload(path ?? "", consent);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).reason, reason);
  }

  assert.deepEqual(readdirSync(assetsDirectory()), files);
  assert.equal(count("assets"), assets);
  assert.equal(count("characters WHERE origin = 'upload'"), 0);
});

test("a consented image becomes one upload character, however often it is sent", async () => {
  const first = await upload("fixtures/wan/reference.png", "true");
  assert.equal(first.status, 201);
  const character = await first.json();
  assert.equal(character.origin, "upload");
  assert.equal(character.is_sample, false);
  assert.ok(Date.parse(character.consent_at));

  const second = await upload("fixtures/wan/reference.png", "true");
  assert.equal(second.status, 200);
  assert.equal((await second.json()).id, character.id);
});
