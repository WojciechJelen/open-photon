import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import "./temp-database.ts";
import type { Recipe } from "../src/features/motionTransfer/server/recipe.ts";
import { motionTransferDefinition } from "../src/features/motionTransfer/workflows/definition.ts";
import {
  createGeneration,
  findReusable,
  markQueued,
  markUnknown,
  transition,
} from "../src/shared/server/generation/generations.ts";
import { recipeHash } from "../src/shared/server/generation/recipe-hash.ts";

// The rows here are Motion Transfer's, on Comfy Cloud.
const cloud = { kind: "cloud", origin: null } as const;

let seed = 0;

/** A recipe no other test uses, so `findReusable` only ever sees this test's rows. */
function recipe(): Recipe {
  seed += 1;

  return {
    inputs: { driving_video_sha256: "a".repeat(64), reference_image_sha256: "b".repeat(64) },
    models: [],
    params: { fragment_length: 81, height: 848, prompt: "A dancer", seed, width: 480 },
    target: "cloud",
    workflow: { id: "motion-transfer", sha256: "c".repeat(64), version: 1 },
  };
}

function finished(id: string) {
  markQueued(id, randomUUID());
  transition(id, "queued", "running");
  transition(id, "running", "finalizing");

  return transition(id, "finalizing", "done");
}

test("createGeneration stores the idempotency key before any provider call", () => {
  const { id } = createGeneration(motionTransferDefinition, { recipe: recipe(), target: cloud });

  const reader = new DatabaseSync(String(process.env.DATABASE_PATH), { readOnly: true });

  const stored = reader
    .prepare("SELECT status, idempotency_key, provider_job_id FROM generations WHERE id = ?")
    .get(id);

  reader.close();

  assert.equal(stored?.status, "preparing");
  assert.match(String(stored?.idempotency_key), /^[0-9a-f-]{36}$/);
  assert.equal(stored?.provider_job_id, null);
});

test("transition rejects done → running and queued → done", () => {
  const done = createGeneration(motionTransferDefinition, { recipe: recipe(), target: cloud });
  finished(done.id);

  assert.throws(() => transition(done.id, "done", "running"), /cannot go from done to running/);

  const queued = createGeneration(motionTransferDefinition, { recipe: recipe(), target: cloud });
  markQueued(queued.id, randomUUID());

  assert.throws(() => transition(queued.id, "queued", "done"), /cannot go from queued to done/);
  assert.equal(transition(queued.id, "queued", "running").status, "running");
});

test("an unknown row stays unknown: it never gets a job id or a new status", () => {
  const { id } = createGeneration(motionTransferDefinition, { recipe: recipe(), target: cloud });

  assert.equal(markUnknown(id).status, "unknown");
  assert.throws(() => markQueued(id, randomUUID()), /is not preparing/);
  assert.throws(() => transition(id, "unknown", "failed"), /cannot go from unknown to failed/);
});

test("findReusable returns a row with the same recipe_hash only once it is done", () => {
  const shared = recipe();
  const hash = recipeHash(shared);
  const failed = createGeneration(motionTransferDefinition, { recipe: shared, target: cloud });
  transition(failed.id, "preparing", "failed");

  const { id } = createGeneration(motionTransferDefinition, { recipe: shared, target: cloud });

  assert.equal(findReusable(hash, motionTransferDefinition), null);
  markQueued(id, randomUUID());
  transition(id, "queued", "running");
  transition(id, "running", "finalizing");
  assert.equal(findReusable(hash, motionTransferDefinition), null);
  transition(id, "finalizing", "done");

  assert.equal(findReusable(hash, motionTransferDefinition)?.id, id);
});

test("a child row keeps parent_id and gets its own idempotency key", () => {
  const shared = recipe();

  const parent = finished(
    createGeneration(motionTransferDefinition, { recipe: shared, target: cloud }).id,
  );

  const child = createGeneration(motionTransferDefinition, {
    parentId: parent.id,
    recipe: shared,
    target: cloud,
  });

  assert.equal(child.parent_id, parent.id);
  assert.equal(child.recipe_hash, parent.recipe_hash);
  assert.notEqual(child.idempotency_key, parent.idempotency_key);
  assert.equal(child.status, "preparing");
});
