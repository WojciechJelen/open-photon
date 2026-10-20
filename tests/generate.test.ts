import "./temp-database.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";

import { ComfyError, IdempotencyKeyReuse, InvalidWorkflow } from "@comfyorg/sdk";
import { z } from "zod";

import { findAccessCode } from "../src/server/access-codes.ts";
import { type Provider, providerTarget } from "../src/server/comfy.ts";
import { database } from "../src/server/db.server.ts";
import {
  GenerateError,
  generate,
  handleGenerate,
  readGeneration,
  rerun,
  retry,
} from "../src/server/generate.ts";
import {
  createGeneration,
  findGeneration,
  findPending,
  markQueued,
  recordProviderInputs,
  transition,
} from "../src/server/generations.ts";
import type { Recipe } from "../src/server/recipe.ts";
import { uploadVideo } from "../src/server/videos.server.ts";
import { mintCode } from "./temp-database.ts";

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

/** The session every generation here is started with: a code with plenty of generations. */
const session = { codeId: findAccessCode(mintCode(1000))?.id ?? "" };

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

  const { id, reused } = await generate(input(), session, double);
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
  const first = await generate(same, session, double);
  const second = await generate(same, session, double);

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
    const failed = findGeneration((await generate(inputs, session, refusing.double)).id);

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
  const fresh = await generate(interrupted.inputs, session, double);

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

  assert.deepEqual(await generate(uncertain.inputs, session, double), {
    id: uncertain.id,
    reused: true,
  });
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

    const { id } = await generate(input(), session, double);
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

  const parent = await generate(input(), session, failing.double);
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const child = await retry(parent.id, session, double);
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
    session,
    provider(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")))
      .double,
  );

  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));

  await assert.rejects(retry(unknown.id, session, double), (error) => {
    assert.ok(error instanceof GenerateError);
    assert.equal(error.status, 409);
    assert.match(error.message, /README/);

    return true;
  });

  const queued = await generate(input(), session, double);

  await assert.rejects(retry(queued.id, session, double), { status: 409 });
  assert.equal(submits.length, 1);
});

test("an angle appends its phrasing to the prompt and is part of the recipe; an unknown one is refused", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const same = { ...input(), prompt: "A dancer" };

  const angled = findGeneration(
    (await generate({ ...same, angle: "profile" }, session, double)).id,
  );

  const plain = findGeneration((await generate(same, session, double)).id);

  assert.equal(angled?.recipe.angle, "profile");
  assert.match(angled?.recipe.params.prompt ?? "", /^A dancer Profile view: /);
  assert.equal(plain?.recipe.angle, undefined);
  assert.equal(plain?.recipe.params.prompt, "A dancer");
  assert.notEqual(plain?.recipe_hash, angled?.recipe_hash);

  await assert.rejects(generate({ ...input(), angle: "upside-down" }, session, double), {
    status: 422,
  });
  assert.equal(submits.length, 2);
});

/** A generation of `inputs` (fresh ones by default) taken to `done` (nothing is downloaded). */
async function doneGeneration(double: Provider, inputs = input()) {
  const { id } = await generate(inputs, session, double);

  transition(id, "queued", "finalizing");

  return transition(id, "finalizing", "done");
}

test("rerun of a failed generation submits a child with the same recipe_hash and the same seed", async () => {
  const failing = provider(() =>
    Promise.reject(new InvalidWorkflow("Rejected", { code: "invalid_workflow", httpStatus: 400 })),
  );

  const parent = findGeneration((await generate(input(), session, failing.double)).id);
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));

  assert.ok(parent);

  const child = await rerun(parent.id, session, double);
  const row = findGeneration(child.id);

  assert.equal(child.reused, false);
  assert.equal(submits.length, 1);
  assert.equal(row?.parent_id, parent.id);
  assert.equal(row?.status, "queued");
  assert.equal(row?.recipe_hash, parent.recipe_hash);
  assert.equal(row?.recipe.params.seed, parent.recipe.params.seed);
});

test("rerun of a done generation returns the parent's output: no child, no submit", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const parent = await doneGeneration(double);
  const rows = database.prepare("SELECT count(*) AS n FROM generations").get()?.n;

  assert.deepEqual(await rerun(parent.id, session, double), { id: parent.id, reused: true });
  assert.equal(submits.length, 1);
  assert.equal(database.prepare("SELECT count(*) AS n FROM generations").get()?.n, rows);
});

test("rerun of a done generation made on another target renders a child with the same seed here", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const here = findGeneration((await generate(input(), session, double)).id);

  assert.ok(here);

  // A done generation of a recipe this target has not rendered: another seed, the other target.
  const parent = createGeneration({
    characterId: here.character_id ?? undefined,
    recipe: {
      ...here.recipe,
      params: { ...here.recipe.params, seed: here.recipe.params.seed + 1_000_000 },
      target: providerTarget() === "cloud" ? "selfhost" : "cloud",
    },
  });

  markQueued(parent.id, `job-${parent.id}`);
  transition(parent.id, "queued", "finalizing");
  transition(parent.id, "finalizing", "done");

  const child = await rerun(parent.id, session, double);
  const row = findGeneration(child.id);

  assert.equal(child.reused, false);
  assert.equal(submits.length, 2);
  assert.equal(row?.parent_id, parent.id);
  assert.equal(row?.recipe.target, providerTarget());
  assert.equal(row?.recipe.params.seed, parent.recipe.params.seed);
  assert.notEqual(row?.recipe_hash, parent.recipe_hash);
});

const rows = () =>
  Number(database.prepare("SELECT count(*) AS count FROM generations").get()?.count);

test("without a session only an existing result comes back, for free: a pre-rendered sample, or a re-run of a done generation", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const sample = input();
  const other = input();
  const prerendered = await doneGeneration(double, sample);
  const done = await doneGeneration(double, other);

  database.prepare("UPDATE generations SET is_prerendered = 1 WHERE id = ?").run(prerendered.id);

  const before = rows();

  assert.deepEqual(await generate(sample, null, double), { id: prerendered.id, reused: true });
  assert.deepEqual(await rerun(done.id, null, double), { id: done.id, reused: true });

  // Anything else (a done generation that is no sample, a new recipe) asks for the code.
  for (const refused of [other, input()]) {
    await assert.rejects(generate(refused, null, double), {
      reason: "access_required",
      status: 401,
    });
  }

  const response = await handleGenerate(
    new Request("http://localhost/api/generate", {
      body: JSON.stringify(input()),
      method: "POST",
    }),
    double,
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).reason, "access_required");
  assert.equal(
    (
      await handleGenerate(
        new Request("http://localhost/api/generate", { body: "{}", method: "POST" }),
        double,
      )
    ).status,
    400,
  );
  assert.equal(submits.length, 2);
  assert.equal(rows(), before);
});

test("a code counts each generation Comfy may have accepted, once, and refuses past its maximum", async () => {
  const limited = { codeId: findAccessCode(mintCode(2))?.id ?? "" };

  const used = () =>
    Number(
      database.prepare("SELECT used FROM access_codes WHERE id = ?").get(limited.codeId)?.used,
    );

  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const first = input();
  const { id } = await generate(first, limited, double);

  assert.equal(used(), 1);
  assert.equal(findGeneration(id)?.access_code_id, limited.codeId);

  // The same recipe again is the same generation, so it is not counted again.
  assert.deepEqual(await generate(first, limited, double), { id, reused: true });
  assert.equal(used(), 1);

  // Comfy unreachable before the submit: nothing reached it, so the count comes back.
  const unreachable = provider((key) => Promise.resolve(`job-${key}`));

  unreachable.double.upload = () => Promise.reject(new TypeError("fetch failed"));

  const failed = await generate(input(), limited, unreachable.double);

  assert.equal(findGeneration(failed.id)?.status, "failed");
  assert.equal(used(), 1);

  // An uncertain submit may have reached Comfy: it counts.
  const uncertain = provider(() =>
    Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
  );

  assert.equal(
    findGeneration((await generate(input(), limited, uncertain.double)).id)?.status,
    "unknown",
  );
  assert.equal(used(), 2);

  const before = rows();

  await assert.rejects(generate(input(), limited, double), {
    reason: "code_exhausted",
    status: 403,
  });
  assert.equal(rows(), before);
  assert.equal(submits.length, 1);
  assert.equal(used(), 2);
});
