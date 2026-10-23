import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import type { GenerationReceipt } from "../../../shared/contracts.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { findBySha256 } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findGeneration } from "../../../shared/server/generation/generations.ts";
import { readGeneration, rerun } from "../../../shared/server/generation/service.ts";
import { type Preset, presetSchema, presets } from "../catalog.ts";
import { presetAvailability, readPreset, readPresets } from "./catalog.ts";
import { generateFromPreset, handlePresetGenerate } from "./generate.ts";

// `comfyProvider` (the default of every call below) is the fake, on a self-hosted dead port.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

const code = mintCode(100);
const session = { codeId: findAccessCode(code)?.id ?? "" };

const character = z
  .object({ id: z.uuid() })
  .parse(database.prepare("SELECT id FROM characters WHERE is_sample = 1 LIMIT 1").get());

const [shipped] = presets;

assert.ok(shipped);

const clip = findBySha256(shipped.motion.sha256);

assert.ok(clip);

const recipeSchema = z.object({
  inputs: z.object({ driving_video_sha256: z.string() }),
  params: z.object({ prompt: z.string(), seed: z.int() }),
});

const provenanceSchema = z.object({
  overrides: z.string(),
  preset: z.string(),
  preset_id: z.string(),
  preset_version: z.int(),
});

let seeds = 1000;

/** A test catalog: the shipped presets plus `preset`, a version of the first with its own seed. */
function catalogWith(change: Partial<Preset>) {
  seeds += 1;

  const preset = presetSchema.parse({
    ...shipped,
    defaults: { prompt: "A preset look for a test.", seed: seeds },
    id: "test-preset",
    ...change,
  });

  return { catalog: [...presets, preset], preset };
}

const used = () => findAccessCode(code)?.used;

const generationCount = () =>
  Number(database.prepare("SELECT count(*) AS count FROM generations").get()?.count);

const provenance = (id: string) =>
  provenanceSchema.parse(
    database
      .prepare(
        "SELECT preset_id, preset_version, preset, overrides FROM preset_generations WHERE generation_id = ?",
      )
      .get(id),
  );

/** Asserts `start` is refused with `status` and `reason` and stores and charges nothing. */
async function assertRefused(
  start: () => Promise<GenerationReceipt>,
  status: number,
  reason: string,
) {
  const before = { count: generationCount(), used: used() };

  await assert.rejects(start, (error) => {
    assert.ok(error instanceof GenerateError);
    assert.equal(error.status, status);
    assert.equal(error.reason, reason);

    return true;
  });
  assert.deepEqual({ count: generationCount(), used: used() }, before);
}

test("every shipped preset is ready on a seeded server, with the stored clip of its sample motion", () => {
  const views = readPresets();

  assert.deepEqual(
    views.map(({ preset }) => preset.id),
    presets.map(({ id }) => id),
  );

  for (const { availability } of views) {
    assert.deepEqual(availability, { motion: clip.id, status: "ready" });
  }

  assert.equal(readPreset("neon-night")?.preset.title, "Neon night");
  assert.equal(readPreset("no-such-preset"), null);
});

test("a preset for a workflow version the server does not run, or whose clip is not stored, is unavailable and says why", () => {
  const { preset: future } = catalogWith({ workflow: { id: "motion-transfer", version: 99 } });

  const { preset: lost } = catalogWith({
    motion: { ...shipped.motion, sha256: "0".repeat(64) },
  });

  assert.deepEqual(presetAvailability(future), {
    message: "This server does not run motion-transfer v99, the workflow this preset was made for.",
    reason: "unsupported_workflow",
    status: "unavailable",
  });
  assert.deepEqual(presetAvailability(lost), {
    message: "The Street dance clip this preset uses is not on this server.",
    reason: "motion_unavailable",
    status: "unavailable",
  });
});

test("a take from a preset renders its motion, look and seed through Motion Transfer and records the preset version it came from", async () => {
  const { catalog, preset } = catalogWith({});
  const before = used();

  const receipt = await generateFromPreset(
    preset.id,
    { character_id: character.id, version: preset.version },
    session,
    { catalog },
  );

  assert.equal(receipt.reused, false);
  assert.equal(used(), (before ?? 0) + 1);

  const row = findGeneration(receipt.id);
  const recipe = recipeSchema.parse(row?.recipe);

  assert.equal(row?.workflow_id, "motion-transfer");
  assert.equal(row?.workflow_version, 1);
  assert.equal(row?.character_id, character.id);
  assert.equal(recipe.inputs.driving_video_sha256, shipped.motion.sha256);
  assert.deepEqual(recipe.params.prompt, "A preset look for a test.");
  assert.deepEqual(recipe.params.seed, preset.defaults.seed);

  const recorded = provenance(receipt.id);

  assert.equal(recorded.preset_id, "test-preset");
  assert.equal(recorded.preset_version, 1);
  assert.deepEqual(JSON.parse(recorded.preset), preset);
  assert.deepEqual(JSON.parse(recorded.overrides), {});

  assert.equal((await readGeneration(receipt.id))?.status, "done");

  // The same choices again are the same recipe: the take comes back, nothing new is recorded.
  const again = await generateFromPreset(
    preset.id,
    { character_id: character.id, version: preset.version },
    session,
    { catalog },
  );

  assert.deepEqual(again, { id: receipt.id, reused: true });
  assert.equal(used(), (before ?? 0) + 1);
});

test("the visitor's changes win over the preset's, and a reset falls back to Motion Transfer's own default", async () => {
  const { catalog, preset } = catalogWith({});

  const changed = await generateFromPreset(
    preset.id,
    { character_id: character.id, prompt: "My own look.", seed: 31, version: 1 },
    session,
    { catalog },
  );

  assert.deepEqual(recipeSchema.parse(findGeneration(changed.id)?.recipe).params, {
    prompt: "My own look.",
    seed: 31,
  });
  assert.deepEqual(JSON.parse(provenance(changed.id).overrides), {
    prompt: "My own look.",
    seed: 31,
  });

  const reset = await generateFromPreset(
    preset.id,
    { character_id: character.id, prompt: "", seed: "default", version: 1 },
    session,
    { catalog },
  );

  const params = recipeSchema.parse(findGeneration(reset.id)?.recipe).params;

  assert.equal(params.prompt, shipped.defaults.prompt);
  assert.equal(params.seed, 20261019);
});

test("an unknown, stale or unavailable preset, or an unknown character, is refused before anything is stored or charged", async () => {
  const { catalog, preset } = catalogWith({ version: 2 });
  const input = { character_id: character.id, version: 2 };

  await assertRefused(
    () => generateFromPreset("no-such-preset", input, session, { catalog }),
    404,
    "preset_not_found",
  );
  await assertRefused(
    () => generateFromPreset(preset.id, { ...input, version: 1 }, session, { catalog }),
    409,
    "preset_stale",
  );

  const { catalog: unsupported } = catalogWith({
    version: 2,
    workflow: { id: "motion-transfer", version: 99 },
  });

  await assertRefused(
    () => generateFromPreset(preset.id, input, session, { catalog: unsupported }),
    409,
    "preset_unavailable",
  );

  const { catalog: missing } = catalogWith({
    motion: { ...shipped.motion, sha256: "0".repeat(64) },
    version: 2,
  });

  await assertRefused(
    () => generateFromPreset(preset.id, input, session, { catalog: missing }),
    409,
    "preset_unavailable",
  );

  const before = { count: generationCount(), used: used() };

  await assert.rejects(
    generateFromPreset(
      preset.id,
      { ...input, character_id: "00000000-0000-4000-8000-000000000000" },
      session,
      { catalog },
    ),
    /Character not found/,
  );
  assert.deepEqual({ count: generationCount(), used: used() }, before);

  // Without the access code nothing new is submitted.
  await assertRefused(
    () => generateFromPreset(preset.id, input, null, { catalog }),
    401,
    "access_required",
  );
});

test("after the catalog changes, an earlier take still re-runs its own version's look and seed, and a request for the old version is refused as stale", async () => {
  // The fake provider fails a graph carrying this marker, so the re-run is a new generation.
  const { catalog: v1, preset: first } = catalogWith({
    defaults: { prompt: "Version one look. [fake:provider_failed]", seed: 501 },
  });

  const made = await generateFromPreset(
    first.id,
    { character_id: character.id, version: 1 },
    session,
    { catalog: v1 },
  );

  assert.equal((await readGeneration(made.id))?.status, "failed");

  // The catalog moves on: version 2 has another look and seed.
  const { catalog: v2 } = catalogWith({
    defaults: { prompt: "Version two look.", seed: 502 },
    version: 2,
  });

  const child = await rerun(made.id, session);

  assert.notEqual(child.id, made.id);
  assert.deepEqual(recipeSchema.parse(findGeneration(child.id)?.recipe).params, {
    prompt: "Version one look. [fake:provider_failed]",
    seed: 501,
  });
  assert.equal(provenance(made.id).preset_version, 1);
  assert.equal(JSON.parse(provenance(made.id).preset).defaults.prompt, first.defaults.prompt);

  await assertRefused(
    () =>
      generateFromPreset(first.id, { character_id: character.id, version: 1 }, session, {
        catalog: v2,
      }),
    409,
    "preset_stale",
  );
});

test("POST /api/presets/:presetId/generations validates the body before anything else and answers like POST /api/generate", async () => {
  const post = (presetId: string, body: { character_id: string; version: number }) =>
    handlePresetGenerate(
      new Request(`http://localhost/api/presets/${presetId}/generations`, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      presetId,
    );

  const malformed = await post(shipped.id, { character_id: "nope", version: 1 });

  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).reason, "invalid_input");

  const stale = await post(shipped.id, {
    character_id: character.id,
    version: shipped.version + 1,
  });

  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).reason, "preset_stale");

  const anonymous = await post(shipped.id, {
    character_id: character.id,
    version: shipped.version,
  });

  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).reason, "access_required");
});
