import "./temp-database.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";

import { z } from "zod";

import type { Provider } from "../src/server/comfy.ts";
import { database } from "../src/server/db.server.ts";
import { generate, readGeneration } from "../src/server/generate.ts";
import {
  createGeneration,
  findGeneration,
  findPending,
  recordProviderInputs,
} from "../src/server/generations.ts";
import type { Recipe } from "../src/server/recipe.ts";
import { uploadVideo } from "../src/server/videos.server.ts";

const form = new FormData();

form.append("file", new Blob([readFileSync("fixtures/x.mp4")]), "x.mp4");

const motion = z
  .object({ id: z.uuid() })
  .parse(
    await (
      await uploadVideo(new Request("http://localhost/api/uploads", { body: form, method: "POST" }))
    ).json(),
  );

const character = z
  .object({ id: z.uuid() })
  .parse(database.prepare("SELECT id FROM characters WHERE is_sample = 1 LIMIT 1").get());

let seed = 0;

/** Inputs no other test uses, so reuse only ever finds this test's rows. */
function input() {
  seed += 1;

  return { character_id: character.id, seed, upload_asset_id: motion.id };
}

/** A provider double that records each submit and answers with `respond`. */
function provider(respond: (idempotencyKey: string) => Promise<string>) {
  const submits: string[] = [];

  const double: Provider = {
    job: () => Promise.reject(new Error("This test never reads a job")),
    submit: (_graph, idempotencyKey) => {
      submits.push(idempotencyKey);

      return respond(idempotencyKey);
    },
    upload: (path) => Promise.resolve({ __type: "core/ASSET", info: { id: basename(path) } }),
  };

  return { double, submits };
}

test("the idempotency key and provider inputs are stored before submit, the job id right after", async () => {
  const { double, submits } = provider((key) => {
    const row = database
      .prepare(
        "SELECT status, idempotency_key, provider_inputs FROM generations WHERE idempotency_key = ?",
      )
      .get(key);

    assert.equal(row?.status, "preparing");
    assert.notEqual(row?.provider_inputs, null);

    return Promise.resolve(`job-${key}`);
  });

  const { id, reused } = await generate(input(), double);
  const row = findGeneration(id);

  assert.equal(reused, false);
  assert.equal(submits.length, 1);
  assert.equal(row?.status, "queued");
  assert.equal(row?.provider_job_id, `job-${submits[0]}`);
  assert.equal(row?.idempotency_key, submits[0]);
});

test("the same inputs and seed return the generation on its way without a second submit", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const same = input();
  const first = await generate(same, double);
  const second = await generate(same, double);

  assert.deepEqual(second, { id: first.id, reused: true });
  assert.equal(submits.length, 1);
  assert.equal(
    database.prepare("SELECT count(*) AS n FROM generations WHERE id = ?").get(first.id)?.n,
    1,
  );
});

test("a row a stopped server left preparing is settled on its next read, never resubmitted", () => {
  const recipe = (seed: number): Recipe => ({
    inputs: { driving_video_sha256: "a".repeat(64), reference_image_sha256: "b".repeat(64) },
    models: [],
    params: { fragment_length: 81, height: 848, prompt: "A dancer", seed, width: 480 },
    target: "cloud",
    workflow: { id: "motion-transfer", sha256: "c".repeat(64), version: 1 },
  });

  // Stopped while uploading: nothing was sent.
  const beforeSubmit = createGeneration({ recipe: recipe(1) });

  assert.deepEqual(
    [readGeneration(beforeSubmit.id)?.status, readGeneration(beforeSubmit.id)?.error_code],
    ["failed", "interrupted"],
  );

  // Stopped after the uploads: the submit may have reached Comfy.
  const afterUploads = createGeneration({ recipe: recipe(2) });
  recordProviderInputs(afterUploads.id, {
    driving_video: { __type: "core/ASSET", info: { id: "video" } },
    reference_image: { __type: "core/ASSET", info: { id: "image" } },
  });

  assert.equal(readGeneration(afterUploads.id)?.status, "unknown");
  assert.equal(findPending(afterUploads.recipe_hash)?.id, afterUploads.id);
  assert.equal(findGeneration(afterUploads.id)?.provider_job_id, null);
});
