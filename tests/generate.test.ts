import "./temp-database.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";

import { ComfyError, IdempotencyKeyReuse, InvalidWorkflow } from "@comfyorg/sdk";
import { z } from "zod";

import type { Provider } from "../src/server/comfy.ts";
import { database } from "../src/server/db.server.ts";
import { GenerateError, generate, readGeneration, retry } from "../src/server/generate.ts";
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

  return { character_id: character.id, motion_asset_id: motion.id, seed };
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

test("a row a stopped server left preparing is settled on its next read, never resubmitted", async () => {
  const recipe = (seed: number): Recipe => ({
    inputs: { driving_video_sha256: "a".repeat(64), reference_image_sha256: "b".repeat(64) },
    models: [],
    params: { fragment_length: 81, height: 848, prompt: "A dancer", seed, width: 480 },
    target: "cloud",
    workflow: { id: "motion-transfer", sha256: "c".repeat(64), version: 1 },
  });

  // Stopped while uploading: nothing was sent.
  const beforeSubmit = createGeneration({ recipe: recipe(1) });

  const interrupted = await readGeneration(beforeSubmit.id);

  assert.deepEqual([interrupted?.status, interrupted?.error_code], ["failed", "interrupted"]);

  // Stopped after the uploads: the submit may have reached Comfy.
  const afterUploads = createGeneration({ recipe: recipe(2) });
  recordProviderInputs(afterUploads.id, {
    driving_video: { __type: "core/ASSET", info: { id: "video" } },
    reference_image: { __type: "core/ASSET", info: { id: "image" } },
  });

  assert.equal((await readGeneration(afterUploads.id))?.status, "unknown");
  assert.equal(findPending(afterUploads.recipe_hash)?.id, afterUploads.id);
  assert.equal(findGeneration(afterUploads.id)?.provider_job_id, null);
});

test("after a restart, generating the same recipe again settles the row the stopped server left preparing", async () => {
  const refusing = provider(() =>
    Promise.reject(new InvalidWorkflow("Rejected", { code: "invalid_workflow", httpStatus: 400 })),
  );

  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));

  /** Fresh inputs, plus the row a stopped server left `preparing` with the recipe they build. */
  const abandon = async (uploaded: boolean) => {
    const inputs = input();
    const failed = findGeneration((await generate(inputs, refusing.double)).id);

    assert.ok(failed);

    const { id } = createGeneration({ characterId: character.id, recipe: failed.recipe });

    if (uploaded) {
      recordProviderInputs(id, {
        driving_video: { __type: "core/ASSET", info: { id: "video" } },
        reference_image: { __type: "core/ASSET", info: { id: "image" } },
      });
    }

    return { id, inputs };
  };

  // Stopped while uploading: nothing reached Comfy, so a fresh generation is submitted.
  const interrupted = await abandon(false);
  const fresh = await generate(interrupted.inputs, double);

  assert.equal(fresh.reused, false);
  assert.notEqual(fresh.id, interrupted.id);
  assert.equal(submits.length, 1);
  assert.equal(findGeneration(fresh.id)?.status, "queued");
  assert.deepEqual(
    [findGeneration(interrupted.id)?.status, findGeneration(interrupted.id)?.error_code],
    ["failed", "interrupted"],
  );

  // Stopped after the uploads: Comfy may be rendering it, so it is returned, never resubmitted.
  const uncertain = await abandon(true);

  assert.deepEqual(await generate(uncertain.inputs, double), { id: uncertain.id, reused: true });
  assert.equal(findGeneration(uncertain.id)?.status, "unknown");
  assert.equal(submits.length, 1);
});

test("Comfy's errors map to error codes: a refusal fails the row, an uncertain submit makes it unknown", async () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8188"), {
    code: "ECONNREFUSED",
  });

  const cases = [
    {
      expected: ["failed", "provider_unreachable", 0],
      upload: () => Promise.reject(new TypeError("fetch failed", { cause: refused })),
    },
    {
      expected: ["failed", "provider_rejected", 1],
      submit: () =>
        Promise.reject(
          new InvalidWorkflow("Node 1: class_type Nope does not exist", {
            code: "invalid_workflow",
            httpStatus: 400,
          }),
        ),
    },
    {
      expected: ["unknown", "timeout", 1],
      submit: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    },
    {
      expected: ["unknown", "unknown", 1],
      submit: () =>
        Promise.reject(
          new IdempotencyKeyReuse("Idempotency key already used", {
            code: "idempotency_key_reuse",
            httpStatus: 422,
          }),
        ),
    },
    {
      expected: ["unknown", "unknown", 1],
      submit: () =>
        Promise.reject(new ComfyError("Service unavailable", { code: "error", httpStatus: 503 })),
    },
  ];

  for (const { expected, submit, upload } of cases) {
    const { double, submits } = provider(submit ?? (() => Promise.reject(new Error("unused"))));

    if (upload) {
      double.upload = upload;
    }

    const { id } = await generate(input(), double);
    const row = findGeneration(id);

    assert.deepEqual([row?.status, row?.error_code, submits.length], expected);
    assert.equal(row?.provider_job_id, null);
    assert.ok(row?.error_message);
  }
});

test("retry submits a child with the same recipe and a new seed", async () => {
  const failing = provider(() =>
    Promise.reject(new InvalidWorkflow("Rejected", { code: "invalid_workflow", httpStatus: 400 })),
  );

  const parent = await generate(input(), failing.double);
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const child = await retry(parent.id, double);
  const [before, after] = [findGeneration(parent.id), findGeneration(child.id)];

  assert.equal(child.reused, false);
  assert.equal(submits.length, 1);
  assert.equal(after?.parent_id, parent.id);
  assert.equal(after?.status, "queued");
  assert.equal(after?.idempotency_key, submits[0]);
  assert.notEqual(after?.recipe.params.seed, before?.recipe.params.seed);
  assert.deepEqual(
    { ...after?.recipe, params: { ...after?.recipe.params, seed: 0 } },
    { ...before?.recipe, params: { ...before?.recipe.params, seed: 0 } },
  );
  assert.equal(after?.character_id, before?.character_id);
});

test("retry refuses an unknown generation with 409 and a pointer to the README", async () => {
  const unknown = await generate(
    input(),
    provider(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")))
      .double,
  );

  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));

  await assert.rejects(retry(unknown.id, double), (error) => {
    assert.ok(error instanceof GenerateError);
    assert.equal(error.status, 409);
    assert.match(error.message, /README/);

    return true;
  });

  const queued = await generate(input(), double);

  await assert.rejects(retry(queued.id, double), { status: 409 });
  assert.equal(submits.length, 1);
});
