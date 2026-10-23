import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { imageDefinition, imageRecipe } from "../../../../tests/test-image-workflow.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { providerTarget } from "../../../shared/server/comfy-target.ts";
import { database } from "../../../shared/server/db.server.ts";
import {
  createGeneration,
  markQueued,
  readOutputs,
  transition,
} from "../../../shared/server/generation/generations.ts";
import { readGeneration, submit } from "../../../shared/server/generation/service.ts";
import { CharacterError, createFromGeneration, getCharacter } from "../api.ts";
import { imageGeneration } from "./fixtures.ts";

// `comfyProvider` (the default of `submit`) is the fake, as in the generation service's tests: a
// self-hosted dead port, so nothing could reach a real Comfy.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

const scope = { free: () => false, session: { codeId: findAccessCode(mintCode(100))?.id ?? "" } };

function count(sql: string, ...values: string[]) {
  return Number(
    database.prepare(`SELECT count(*) AS count FROM characters WHERE ${sql}`).get(...values)?.count,
  );
}

test("a done image generation run through the fake provider is saved once: its output, its recipe's prompt and provenance", async () => {
  const prompt = "A cellist in a green velvet suit, studio light";
  const { id } = await submit(imageDefinition, { prompt, seed: 42 }, { scope });

  assert.equal((await readGeneration(id))?.status, "done");

  const output = readOutputs(id).find(({ name }) => name === "image");
  const first = createFromGeneration({ generationId: id, outputName: "image", title: "Cellist" });
  const second = createFromGeneration({ generationId: id, outputName: "image", title: "Other" });

  assert.ok(output);
  assert.equal(first.created, true);
  assert.deepEqual(second, { character: first.character, created: false });

  // A retry after a reload may not repeat the inputs: the saved character still comes back.
  for (const retried of [
    { outputName: "missing" },
    { outputName: "image", title: "" },
    { outputName: "image", title: "x".repeat(81) },
  ]) {
    assert.deepEqual(createFromGeneration({ generationId: id, ...retried }), {
      character: first.character,
      created: false,
    });
  }

  const { character } = first;

  assert.equal(character.origin, "generated");
  assert.equal(character.generation_id, id);
  assert.equal(character.image_asset_id, output.asset.id);
  assert.equal(character.prompt, prompt);
  assert.equal(character.title, "Cellist");
  assert.equal(character.consent_at, null);
  assert.equal(character.is_sample, false);
  assert.deepEqual(character.provenance, {
    models: [],
    workflow: imageRecipe(prompt, 42).workflow,
  });
  assert.deepEqual(getCharacter(character.id), character);
  assert.equal(count("generation_id = ?", id), 1);
});

test("only a done generation with an image output of that name is saved; nothing is stored otherwise", async () => {
  const refused = (generationId: string, outputName: string, status: number, reason: string) =>
    assert.throws(
      () => createFromGeneration({ generationId, outputName }),
      (error) =>
        error instanceof CharacterError && error.status === status && error.reason === reason,
    );

  const queued = await imageGeneration("Still rendering", { status: "queued" });
  const failed = await imageGeneration("Never made", { status: "failed" });
  const done = await imageGeneration("Made");

  refused(randomUUID(), "image", 404, "not_found");
  refused(queued, "image", 409, "not_done");
  refused(failed, "image", 409, "not_done");
  refused(done, "video", 422, "no_output");

  // A done generation whose output of that name is a video (the sample motion's clip here).
  const clip = z
    .object({ id: z.string() })
    .parse(database.prepare("SELECT id FROM assets WHERE kind = 'video' LIMIT 1").get()).id;

  const { id: video } = createGeneration(imageDefinition, {
    recipe: imageRecipe("A clip", 9),
    target: providerTarget(),
  });

  markQueued(video, `job-${video}`);
  transition(video, "queued", "finalizing");
  transition(video, "finalizing", "done", { outputs: { image: clip } });

  refused(video, "image", 422, "not_image");

  for (const generationId of [queued, failed, done, video]) {
    assert.equal(count("generation_id = ?", generationId), 0);
  }
});

test("a save racing another connection's insert returns that row; the unique index refuses a second one", async () => {
  const generationId = await imageGeneration("Raced");
  const image = readOutputs(generationId)[0]?.asset.id ?? "";
  const other = new DatabaseSync(process.env.DATABASE_PATH ?? "");

  const insert = other.prepare(
    `INSERT INTO characters (id, image_asset_id, origin, generation_id, created_at)
    VALUES (?, ?, 'generated', ?, ?)`,
  );

  try {
    // Another server process saved it first, between this one's checks and its insert.
    other.exec("BEGIN IMMEDIATE");
    insert.run(randomUUID(), image, generationId, new Date().toISOString());
    other.exec("COMMIT");

    const { character, created } = createFromGeneration({ generationId, outputName: "image" });

    assert.equal(created, false);
    assert.equal(count("generation_id = ?", generationId), 1);
    assert.equal(character.generation_id, generationId);

    other.exec("BEGIN IMMEDIATE");
    assert.throws(
      () => insert.run(randomUUID(), image, generationId, new Date().toISOString()),
      /UNIQUE constraint failed: characters\.generation_id/,
    );
    other.exec("ROLLBACK");
  } finally {
    other.close();
  }

  assert.equal(count("generation_id = ?", generationId), 1);
});

// A process that saves the generation `GENERATION_ID` once its parent writes a line: it prints
// `ready` once loaded (the test workflow registered first, as in this file), then the saved
// character's id and whether it created it.
const SAVER = `
import { once } from "node:events";
import { createInterface } from "node:readline";
import ${JSON.stringify(pathToFileURL("tests/test-image-workflow.ts").href)};
import { createFromGeneration } from ${JSON.stringify(pathToFileURL("src/features/characters/api.ts").href)};
const lines = createInterface({ input: process.stdin });
console.log("ready");
await once(lines, "line");
const { character, created } = createFromGeneration({
  generationId: process.env.GENERATION_ID,
  outputName: "image",
});
console.log(JSON.stringify({ created, id: character.id }));
lines.close();
`;

const savedSchema = z.object({ created: z.boolean(), id: z.uuid() });

test("four processes saving one generation at the same instant make one character", async () => {
  const generationId = await imageGeneration("Contended");

  const savers = Array.from({ length: 4 }, () =>
    spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", SAVER],
      { env: { ...process.env, GENERATION_ID: generationId }, stdio: ["pipe", "pipe", "inherit"] },
    ),
  );

  const outputs = savers.map((saver) =>
    createInterface({ input: saver.stdout })[Symbol.asyncIterator](),
  );

  // Every one loaded, then all are told to go at once.
  for (const output of outputs) {
    assert.equal((await output.next()).value, "ready");
  }

  for (const saver of savers) {
    saver.stdin.end("go\n");
  }

  const saved = await Promise.all(
    outputs.map(async (output) =>
      savedSchema.parse(JSON.parse(String((await output.next()).value))),
    ),
  );

  assert.equal(new Set(saved.map(({ id }) => id)).size, 1);
  assert.equal(saved.filter(({ created }) => created).length, 1);
  assert.equal(count("generation_id = ?", generationId), 1);
});
