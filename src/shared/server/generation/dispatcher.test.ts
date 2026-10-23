import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { mintCode } from "../../../../tests/temp-database.ts";
import { imageDefinition, imageRecipe } from "../../../../tests/test-image-workflow.ts";
import type { GenerationReceipt } from "../../contracts.ts";
import { findAccessCode } from "../access-codes.ts";
import { fakeProvider } from "../comfy-provider.fake.ts";
import { comfyProvider, type Provider } from "../comfy-provider.ts";
import { providerTarget } from "../comfy-target.ts";
import { database } from "../db.server.ts";
import { recoverAfterRestart, startDispatcher } from "./dispatcher.ts";
import {
  cancelWaiting,
  createGeneration,
  findGeneration,
  type Generation,
  markQueued,
  markSubmitting,
  transition,
} from "./generations.ts";
import { submit, submitMany } from "./service.ts";

// `comfyProvider` (the default of every call below) is the fake, each job running for 5 × 50 ms
// after its submit, so a place in flight stays taken while a request looks (`refreshInFlight`).
// The target still resolves, as the fake needs (`.env.example`): a self-hosted dead port, so
// nothing could reach a real Comfy. One generation in flight at a time.
const environment = {
  COMFY_API_KEY: "",
  COMFY_BASE_URL: "http://127.0.0.1:1",
  COMFY_FAKE_STEP_MS: "50",
  COMFY_PROVIDER: "fake",
  COMFY_PROXY_TOKEN: "",
  GENERATION_DISPATCH_MS: "20",
  IN_FLIGHT_MAX: "1",
};

Object.assign(process.env, environment);

const code = mintCode(1000);
const session = { codeId: findAccessCode(code)?.id ?? "" };
const scope = { free: () => false, session };

const used = (accessCode = code) => findAccessCode(accessCode)?.used ?? 0;

const rows = () => Number(database.prepare("SELECT count(*) AS n FROM generations").get()?.n);

const statusOf = (id: string) => findGeneration(id)?.status;

/**
 * Waits until `ready` holds, reading only the database: no event stream, no `readGeneration`.
 * The dispatcher works on its own timers and provider calls, so this polls for the outcome
 * rather than driving time.
 */
async function until(ready: () => boolean, what: string) {
  const deadline = Date.now() + 15_000;

  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }

    await delay(10);
  }
}

/** The fake provider, recording the prompt of each graph it is sent, in order. */
function recording() {
  const prompts: string[] = [];

  const provider: Provider = {
    ...comfyProvider,
    submit: (graph, key) => {
      prompts.push(String(graph["2"]?.inputs.text));

      return comfyProvider.submit(graph, key);
    },
  };

  return { prompts, provider };
}

/** A row as a stopped server left it, made directly (`createGeneration`, claimed by this process). */
function leftBehind(prompt: string, status: "preparing" | "waiting") {
  return createGeneration(imageDefinition, {
    accessCodeId: session.codeId,
    recipe: imageRecipe(prompt, 7),
    status,
    target: providerTarget(),
  });
}

const run = promisify(execFile);

/**
 * Runs a second server process on this test's database, as a restart does: it recovers the rows
 * (`recoverAfterRestart`), dispatches until every row of `ids` is final, stops, and reports what
 * recovery did, each row's status and how many provider submits it made.
 */
async function restart(ids: string[]) {
  const script = `
    import { setTimeout as delay } from "node:timers/promises";
    import "./src/app/server.ts";
    import "./tests/test-image-workflow.ts";
    import { fakeProvider } from "./src/shared/server/comfy-provider.fake.ts";
    import { recoverAfterRestart, startDispatcher } from "./src/shared/server/generation/dispatcher.ts";
    import { findGeneration } from "./src/shared/server/generation/generations.ts";
    const ids = ${JSON.stringify(ids)};
    const recovered = recoverAfterRestart();
    const dispatcher = startDispatcher();
    const final = ["done", "failed", "unknown", "cancelled"];
    const deadline = Date.now() + 15000;
    while (!ids.every((id) => final.includes(findGeneration(id)?.status)) && Date.now() < deadline) {
      await delay(10);
    }
    await dispatcher.stop();
    console.log(JSON.stringify({
      recovered,
      statuses: Object.fromEntries(ids.map((id) => [id, findGeneration(id)?.status])),
      submits: fakeProvider.calls.submit,
    }));
  `;

  const { stdout } = await run(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
    { env: { ...process.env, ...environment }, timeout: 30_000 },
  );

  const report: {
    recovered: { cancelled: string[]; released: string[]; unknown: string[] };
    statuses: Record<string, Generation["status"]>;
    submits: number;
  } = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");

  return report;
}

test("with one place in flight, five generations complete in order with no event stream open, one provider submit each", async () => {
  const { prompts, provider } = recording();
  const before = fakeProvider.calls.submit;
  const prompt = (index: number) => `In order ${index}`;
  const receipts: GenerationReceipt[] = [];

  for (let index = 0; index < 5; index++) {
    receipts.push(await submit(imageDefinition, { prompt: prompt(index) }, { provider, scope }));
  }

  // The first took the place; the others wait in line, in order, answered with their places.
  assert.equal(statusOf(receipts[0]?.id ?? ""), "queued");
  assert.deepEqual(
    receipts.slice(1).map(({ position, status }) => [status, position]),
    [
      ["waiting", 1],
      ["waiting", 2],
      ["waiting", 3],
      ["waiting", 4],
    ],
  );

  const dispatcher = startDispatcher({ provider });

  try {
    await until(() => receipts.every(({ id }) => statusOf(id) === "done"), "five done");
  } finally {
    await dispatcher.stop();
  }

  const done = receipts.map(({ id }) => findGeneration(id));

  assert.deepEqual(
    prompts,
    receipts.map((_, index) => prompt(index)),
  );
  assert.equal(fakeProvider.calls.submit - before, 5);

  // One at a time: each was submitted once the one before it had finished.
  for (const [index, row] of done.entries()) {
    const previous = done[index - 1];

    assert.ok(row?.submitted_at && row.finished_at);

    if (previous?.finished_at) {
      assert.ok(row.submitted_at >= previous.finished_at);
    }
  }
});

test("a generation waits in line behind those before it, even when a place opens before the dispatcher runs", async () => {
  const blocker = await submit(imageDefinition, { prompt: "Holds the place" }, { scope });
  const waiting = await submit(imageDefinition, { prompt: "First in line" }, { scope });

  assert.deepEqual([waiting.status, waiting.position], ["waiting", 1]);

  // The place opens, but the line is not empty: a new request does not overtake it.
  transition(blocker.id, "queued", "failed", { error_code: "provider_failed" });

  const later = await submit(imageDefinition, { prompt: "Second in line" }, { scope });

  assert.deepEqual([later.status, later.position], ["waiting", 2]);

  const dispatcher = startDispatcher();

  try {
    await until(
      () => statusOf(waiting.id) === "done" && statusOf(later.id) === "done",
      "the line to drain",
    );
  } finally {
    await dispatcher.stop();
  }

  assert.ok(
    (findGeneration(waiting.id)?.submitted_at ?? "") <=
      (findGeneration(later.id)?.submitted_at ?? ""),
  );
});

test("a stopped dispatcher claims nothing more", async () => {
  const dispatcher = startDispatcher();

  await dispatcher.stop();

  const blocker = await submit(imageDefinition, { prompt: "After the stop, first" }, { scope });
  const waiting = await submit(imageDefinition, { prompt: "After the stop, second" }, { scope });

  transition(blocker.id, "queued", "failed", { error_code: "provider_failed" });

  // Five of its 20 ms polls: a live dispatcher would have claimed the row by now.
  await delay(100);

  assert.equal(statusOf(waiting.id), "waiting");

  const before = used();

  cancelWaiting(waiting.id);

  assert.equal(statusOf(waiting.id), "cancelled");
  assert.equal(used(), before - 1);
});

test("a restart resumes the line: waiting and never-sent rows complete, a possibly-sent or ambiguous row stays unknown, a finalizing one finishes", async () => {
  const before = fakeProvider.calls.submit;

  // Ambiguous: Comfy took the job, the submit call failed, so it is unknown after one submit.
  const ambiguous = await submit(imageDefinition, { prompt: "[fake:ambiguous] Lost" }, { scope });

  assert.equal(statusOf(ambiguous.id), "unknown");

  // Finalizing when the server stopped: Comfy finished, the first download had failed. Its job,
  // like every fake job, outlives this process.
  const finishing = await submit(imageDefinition, { prompt: "Was finalizing" }, { scope });

  transition(finishing.id, "queued", "finalizing");
  database
    .prepare("UPDATE generations SET finalize_attempts = 1, finalize_attempted_at = ? WHERE id = ?")
    .run("2000-01-01T00:00:00.000Z", finishing.id);

  // In line; claimed but never sent; claimed and handed to the provider.
  const waiting = leftBehind("Was waiting", "waiting");
  const beforeSubmit = leftBehind("Was preparing, nothing sent", "preparing");
  const afterSubmit = leftBehind("Was preparing, maybe sent", "preparing");

  markSubmitting(afterSubmit.id);

  // In line for another endpoint than the one the server renders on now.
  const cloud = { kind: "cloud", origin: null } as const;

  const elsewhere = createGeneration(imageDefinition, {
    accessCodeId: session.codeId,
    recipe: imageRecipe("Was waiting elsewhere", 7, cloud),
    status: "waiting",
    target: cloud,
  });

  assert.equal(fakeProvider.calls.submit - before, 2);

  const counted = used();
  const ids = [ambiguous.id, finishing.id, waiting.id, beforeSubmit.id, afterSubmit.id];
  const report = await restart([...ids, elsewhere.id]);

  assert.deepEqual(report.recovered, {
    cancelled: [elsewhere.id],
    released: [beforeSubmit.id],
    unknown: [afterSubmit.id],
  });
  assert.deepEqual(report.statuses, {
    [afterSubmit.id]: "unknown",
    [ambiguous.id]: "unknown",
    [beforeSubmit.id]: "done",
    [elsewhere.id]: "cancelled",
    [finishing.id]: "done",
    [waiting.id]: "done",
  });

  // The restarted process submitted the two never sent, nothing else; the never-sent one under
  // the key it had. The finalizing one kept its attempt count.
  assert.equal(report.submits, 2);
  assert.equal(findGeneration(beforeSubmit.id)?.idempotency_key, beforeSubmit.idempotency_key);
  assert.equal(findGeneration(finishing.id)?.finalize_attempts, 1);
  assert.equal(findGeneration(ambiguous.id)?.provider_job_id, null);

  // Only the cancelled one gave its count back; the unknown ones keep theirs.
  assert.equal(used(), counted - 1);

  // Another restart finds nothing to do: the unknown rows are never submitted again.
  const again = await restart(ids);

  assert.deepEqual(again.recovered, { cancelled: [], released: [], unknown: [] });
  assert.equal(again.submits, 0);
  assert.deepEqual([statusOf(ambiguous.id), statusOf(afterSubmit.id)], ["unknown", "unknown"]);
});

test("recovery in this process: a never-sent preparing row goes back in line where it was; one handed to the provider becomes unknown", () => {
  const first = leftBehind("Recovered first", "preparing");
  const second = leftBehind("Recovered second", "preparing");

  markSubmitting(second.id);

  // No submit of this process holds them, as after a restart.
  const report = recoverAfterRestart();

  assert.deepEqual([report.released, report.unknown], [[first.id], [second.id]]);
  assert.deepEqual(
    [findGeneration(first.id)?.status, findGeneration(first.id)?.claimed_by],
    ["waiting", null],
  );
  assert.equal(statusOf(second.id), "unknown");

  cancelWaiting(first.id);
});

test("submitMany checks every item first: one invalid item stores nothing and charges nothing", () => {
  const before = { rows: rows(), used: used() };

  assert.throws(
    () =>
      submitMany(imageDefinition, [{ prompt: "Fine" }, { prompt: "" }, { prompt: "Also fine" }], {
        requestKey: crypto.randomUUID(),
        scope,
      }),
    { reason: "invalid_input", status: 422 },
  );
  assert.deepEqual({ rows: rows(), used: used() }, before);
});

test("submitMany with quota for two of three new items stores nothing", () => {
  const small = mintCode(2);
  const smallScope = { free: () => false, session: { codeId: findAccessCode(small)?.id ?? "" } };
  const before = rows();

  assert.throws(
    () =>
      submitMany(
        imageDefinition,
        [{ prompt: "Quota one" }, { prompt: "Quota two" }, { prompt: "Quota three" }],
        { requestKey: crypto.randomUUID(), scope: smallScope },
      ),
    { reason: "code_exhausted", status: 403 },
  );
  assert.equal(rows(), before);
  assert.equal(used(small), 0);
});

test("submitMany stores every new item in line at once; the same request key returns the same receipts and stores nothing", () => {
  const requestKey = crypto.randomUUID();
  const items = [{ prompt: "Batch one" }, { prompt: "Batch two" }, { prompt: "Batch three" }];
  const before = { rows: rows(), used: used() };
  let admitted = 0;

  const admit = () => {
    admitted++;
  };

  const receipts = submitMany(imageDefinition, items, { admit, requestKey, scope });

  assert.equal(rows(), before.rows + 3);
  assert.equal(used(), before.used + 3);
  assert.equal(admitted, 1);
  assert.deepEqual(
    receipts.map(({ position, reused, status }) => [reused, status, position]),
    [
      [false, "waiting", 1],
      [false, "waiting", 2],
      [false, "waiting", 3],
    ],
  );
  assert.deepEqual(
    receipts.map(({ id }) => {
      const row = findGeneration(id);

      return [row?.request_key, row?.batch_key];
    }),
    items.map((_, index) => [`${requestKey}#${index}`, requestKey]),
  );

  const repeated = submitMany(imageDefinition, items, { admit, requestKey, scope });

  assert.deepEqual(repeated, receipts);
  assert.equal(rows(), before.rows + 3);
  assert.equal(used(), before.used + 3);
  assert.equal(admitted, 1);

  for (const { id } of receipts) {
    cancelWaiting(id);
  }

  assert.equal(used(), before.used);
});

test("a reused result inside a request costs nothing and takes no place in line, nor does an item repeating another", () => {
  const done = createGeneration(imageDefinition, {
    accessCodeId: session.codeId,
    recipe: imageRecipe("Already made", 7),
    target: providerTarget(),
  });

  markQueued(done.id, `job-${done.id}`);
  transition(done.id, "queued", "finalizing");
  transition(done.id, "finalizing", "done");

  const before = { rows: rows(), used: used() };

  const receipts = submitMany(
    imageDefinition,
    [{ prompt: "Already made" }, { prompt: "Made once" }, { prompt: "Made once" }],
    { requestKey: crypto.randomUUID(), scope },
  );

  assert.deepEqual(receipts[0], { id: done.id, reused: true });
  assert.deepEqual(
    receipts.map(({ reused }) => reused),
    [true, false, true],
  );
  assert.equal(receipts[2]?.id, receipts[1]?.id);
  assert.equal(rows(), before.rows + 1);
  assert.equal(used(), before.used + 1);

  cancelWaiting(receipts[1]?.id ?? "");
});

test("a request key returns the generation it made without resolving the input again; another code's request with it is a 409", async () => {
  const requestKey = crypto.randomUUID();
  const first = await submit(imageDefinition, { prompt: "Keyed" }, { requestKey, scope });
  const before = { rows: rows(), submits: fakeProvider.calls.submit };

  assert.deepEqual(first, { id: first.id, reused: false });

  // Another input under the same key still returns the first generation: the key decides.
  assert.deepEqual(
    await submit(imageDefinition, { prompt: "Keyed, changed" }, { requestKey, scope }),
    first,
  );
  assert.deepEqual({ rows: rows(), submits: fakeProvider.calls.submit }, before);

  const other = { free: () => false, session: { codeId: findAccessCode(mintCode(5))?.id ?? "" } };

  await assert.rejects(submit(imageDefinition, { prompt: "Keyed" }, { requestKey, scope: other }), {
    reason: "request_key_conflict",
    status: 409,
  });
});
