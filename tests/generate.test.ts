import "./temp-database.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { ComfyError, IdempotencyKeyReuse, InvalidWorkflow } from "@comfyorg/sdk";
import { z } from "zod";

import {
  type Provider,
  type ProviderJob,
  providerTarget,
} from "../src/features/motionTransfer/server/comfy.ts";
import {
  GenerateError,
  generate,
  handleGenerate,
  readGeneration,
  rerun,
  retry,
  startChild,
} from "../src/features/motionTransfer/server/generate.ts";
import {
  countInFlight,
  createGeneration,
  findGeneration,
  findPending,
  markQueued,
  recordProviderInputs,
  transition,
} from "../src/features/motionTransfer/server/generations.ts";
import { generateDefaults } from "../src/features/motionTransfer/server/presets.ts";
import type { Recipe } from "../src/features/motionTransfer/server/recipe.ts";
import { readSelection } from "../src/features/motionTransfer/server/selection.ts";
import { uploadVideo } from "../src/features/motionTransfer/server/videos.server.ts";
import { motionTransferModels } from "../src/features/motionTransfer/workflows/registry.ts";
import { findAccessCode } from "../src/shared/server/access-codes.ts";
import { createAccessGuard } from "../src/shared/server/access.server.ts";
import { database } from "../src/shared/server/db.server.ts";
import { mintCode } from "./temp-database.ts";

// The jobs these tests submit stay queued (nothing finishes them), so the in-flight cap is lifted
// except where a test sets it.
process.env.IN_FLIGHT_MAX = "1000";

// Requests name their client in `X-Client`.
process.env.CLIENT_IP_HEADER = "X-Client";

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
  assert.deepEqual(row?.recipe.models, motionTransferModels);
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

test("retry renders on the target this server renders on, like a re-run", async () => {
  const { double } = provider((key) => Promise.resolve(`job-${key}`));
  const here = findGeneration((await generate(input(), session, double)).id);

  assert.ok(here);

  // A generation that failed on the other target.
  const parent = createGeneration({
    characterId: here.character_id ?? undefined,
    recipe: {
      ...here.recipe,
      params: { ...here.recipe.params, seed: here.recipe.params.seed + 1_000_000 },
      target: providerTarget() === "cloud" ? "selfhost" : "cloud",
    },
  });

  transition(parent.id, "preparing", "failed", { error_code: "provider_rejected" });

  const child = findGeneration((await retry(parent.id, session, double)).id);

  assert.equal(child?.parent_id, parent.id);
  assert.equal(child?.recipe.target, providerTarget());
});

test("a blank seed and prompt are fixed defaults: the same choices are the same recipe, which a pre-render with those values matches", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const blank = { character_id: character.id, motion_asset_id: motion.id };
  const first = await generate(blank, session, double);
  const second = await generate(blank, session, double);
  const row = findGeneration(first.id);

  assert.deepEqual(second, { id: first.id, reused: true });
  assert.equal(findGeneration(second.id)?.recipe_hash, row?.recipe_hash);
  assert.equal(row?.recipe.params.prompt, generateDefaults.prompt);
  assert.deepEqual(
    await generate(
      { ...blank, prompt: generateDefaults.prompt, seed: generateDefaults.seed },
      session,
      double,
    ),
    { id: first.id, reused: true },
  );
  assert.equal(submits.length, 1);
});

test("an unknown generation is returned for its recipe for a day, then the recipe can be generated again", async () => {
  const timingOut = provider(() =>
    Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
  );

  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const same = input();
  const unknown = await generate(same, session, timingOut.double);

  assert.equal(findGeneration(unknown.id)?.status, "unknown");
  assert.deepEqual(await generate(same, session, double), { id: unknown.id, reused: true });

  database
    .prepare("UPDATE generations SET created_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), unknown.id);

  const fresh = await generate(same, session, double);

  assert.equal(fresh.reused, false);
  assert.notEqual(fresh.id, unknown.id);
  assert.equal(findGeneration(fresh.id)?.status, "queued");
  assert.equal(submits.length, 1);
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

test("a take's direction comes back as the Direct step held it, for whoever may read the take", async () => {
  const { double } = provider((key) => Promise.resolve(`job-${key}`));
  const look = "Red jacket.\n\nRain  on glass.";

  const shot = await generate(
    { ...input(), angle: "three-quarter", prompt: look, seed: 777 },
    session,
    double,
  );

  const blank = await generate(
    { character_id: character.id, motion_asset_id: motion.id },
    session,
    double,
  );

  // The look as it was typed (its angle phrasing taken off again), line breaks and all.
  assert.deepEqual(readSelection({ from: shot.id }, true).direction, {
    angle: "three-quarter",
    prompt: look,
    seed: "777",
  });

  // The defaults read as a blank form, as they were sent.
  assert.deepEqual(readSelection({ from: blank.id }, true).direction, {
    angle: "none",
    prompt: "",
    seed: "",
  });

  // Without a session a take that is not a pre-rendered sample stays private; an unknown id is none.
  assert.equal(readSelection({ from: shot.id }, false).direction, null);
  assert.equal(readSelection({ from: crypto.randomUUID() }, true).direction, null);
});

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

/** The `name=value` part of a session cookie for `code`, from `POST /api/session`. */
async function sessionCookie(code: string) {
  const response = await createAccessGuard({ production: true })(
    new Request("http://localhost/api/session", {
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  return response?.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

/** A `POST` to `path` from `client`, with the session `cookie` if any. */
function post(path: string, client: string, cookie = "", body = "{}") {
  return new Request(`http://localhost${path}`, {
    body,
    headers: { Cookie: cookie, "X-Client": client },
    method: "POST",
  });
}

/** Comfy's answer for a job that is `status`, without outputs. */
function comfyJob(status: string): ProviderJob {
  return {
    error: null,
    events: () => {
      throw new Error("This test never follows a job's events");
    },
    getOutputs: () => [],
    id: "job",
    status,
  };
}

test("generate, retry and re-run are limited to 3 a minute per code and per client, then 429 with Retry-After and no row; an existing result is free", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const sample = input();
  const done = await doneGeneration(double, sample);
  const spent = await sessionCookie(mintCode(10));
  const busy = await sessionCookie(mintCode(10));
  const fresh = await sessionCookie(mintCode(10));
  const before = rows();

  // One code from three clients: every answer but an existing result costs a token.
  assert.equal((await handleGenerate(post("/api/generate", "a1", spent), double)).status, 400);
  assert.equal(
    (await startChild(post("/api/generations/nope/retry", "a2", spent), "nope", retry, double))
      .status,
    400,
  );

  const unknown = crypto.randomUUID();

  assert.equal(
    (
      await startChild(
        post(`/api/generations/${unknown}/rerun`, "a3", spent),
        unknown,
        rerun,
        double,
      )
    ).status,
    404,
  );

  const limited = await handleGenerate(
    post("/api/generate", "a4", spent, JSON.stringify(input())),
    double,
  );

  const body = await limited.json();

  assert.equal(limited.status, 429);
  assert.equal(body.reason, "rate_limited");
  assert.equal(limited.headers.get("Retry-After"), String(body.retry_after));
  assert.ok(body.retry_after > 0);

  // An existing result costs nothing and is not refused: the same recipe for the spent code, and
  // a re-run of a done generation five times from a client that then still has its tokens.
  const same = await handleGenerate(
    post("/api/generate", "a4", spent, JSON.stringify(sample)),
    double,
  );

  assert.deepEqual([same.status, await same.json()], [200, { id: done.id, reused: true }]);

  for (let index = 0; index < 5; index++) {
    const rerunOfDone = post(`/api/generations/${done.id}/rerun`, "a5");

    assert.equal((await startChild(rerunOfDone, done.id, rerun, double)).status, 200);
  }

  assert.equal((await handleGenerate(post("/api/generate", "a5"), double)).status, 400);

  // One client with one code three times: that client is refused with another code, or none.
  for (let index = 0; index < 3; index++) {
    assert.equal((await handleGenerate(post("/api/generate", "b1", busy), double)).status, 400);
  }

  assert.equal(
    (await handleGenerate(post("/api/generate", "b1", fresh, JSON.stringify(input())), double))
      .status,
    429,
  );
  assert.equal((await handleGenerate(post("/api/generate", "b1"), double)).status, 429);
  assert.equal(rows(), before);
  assert.equal(submits.length, 1);
});

test("with the in-flight cap full, a new generation is a 503 queue_full with Retry-After and no row; an existing result still comes back", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));

  double.job = () => Promise.resolve(comfyJob("running"));

  const sample = input();
  const done = await doneGeneration(double, sample);
  const cookie = await sessionCookie(mintCode(10));
  const before = rows();

  process.env.IN_FLIGHT_MAX = "0";

  try {
    const full = await handleGenerate(
      post("/api/generate", "c1", cookie, JSON.stringify(input())),
      double,
    );

    const body = await full.json();

    assert.equal(full.status, 503);
    assert.equal(body.reason, "queue_full");
    assert.equal(full.headers.get("Retry-After"), String(body.retry_after));
    assert.ok(body.retry_after > 0);
    assert.deepEqual(await generate(sample, session, double), { id: done.id, reused: true });
    assert.deepEqual(await rerun(done.id, null, double), { id: done.id, reused: true });
    assert.equal(rows(), before);
    assert.equal(submits.length, 1);
  } finally {
    process.env.IN_FLIGHT_MAX = "1000";
  }
});

test("a full cap is refreshed first: generations that ended while nobody watched give their places back", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const abandoned = findGeneration((await generate(input(), session, double)).id);

  assert.ok(abandoned);

  // Left `preparing` by a stopped server, and queued on Comfy where the job then failed; both the
  // oldest in flight, so the refresh reaches them.
  const stopped = createGeneration({
    characterId: character.id,
    recipe: {
      ...abandoned.recipe,
      params: { ...abandoned.recipe.params, seed: abandoned.recipe.params.seed + 1_000_000 },
    },
  });

  database
    .prepare("UPDATE generations SET created_at = ? WHERE id IN (?, ?)")
    .run("2000-01-01T00:00:00.000Z", abandoned.id, stopped.id);

  double.job = (jobId) =>
    Promise.resolve(comfyJob(jobId === abandoned.provider_job_id ? "failed" : "running"));

  process.env.IN_FLIGHT_MAX = String(countInFlight());

  try {
    const fresh = await generate(input(), session, double);

    assert.equal(fresh.reused, false);
    assert.equal(findGeneration(fresh.id)?.status, "queued");
    assert.equal(submits.length, 2);
    assert.deepEqual(
      [findGeneration(abandoned.id)?.error_code, findGeneration(stopped.id)?.error_code],
      ["provider_failed", "interrupted"],
    );
  } finally {
    process.env.IN_FLIGHT_MAX = "1000";
  }
});

test("two requests for one new recipe while a full cap is refreshed: one starts it, the other gets it back and its token too", async () => {
  const { double, submits } = provider((key) => Promise.resolve(`job-${key}`));
  const abandoned = findGeneration((await generate(input(), session, double)).id);

  assert.ok(abandoned);
  database
    .prepare("UPDATE generations SET created_at = ? WHERE id = ?")
    .run("2000-01-01T00:00:00.000Z", abandoned.id);

  // The refresh takes a while, so both requests are admitted before it frees the place.
  double.job = async (jobId) => {
    await delay(50);

    return comfyJob(jobId === abandoned.provider_job_id ? "failed" : "running");
  };

  const cookie = await sessionCookie(mintCode(10));
  const body = JSON.stringify(input());

  process.env.IN_FLIGHT_MAX = String(countInFlight());

  try {
    const answers = await Promise.all([
      handleGenerate(post("/api/generate", "e1", cookie, body), double),
      handleGenerate(post("/api/generate", "e1", cookie, body), double),
    ]);

    assert.deepEqual(
      answers.map(({ status }) => status).sort((a, b) => a - b),
      [200, 201],
    );
    assert.equal(submits.length, 2);

    // Only the started one cost a token (3 a minute): two more answers, then a 429.
    for (const status of [400, 400, 429]) {
      assert.equal(
        (await handleGenerate(post("/api/generate", "e1", cookie), double)).status,
        status,
      );
    }
  } finally {
    process.env.IN_FLIGHT_MAX = "1000";
  }
});
