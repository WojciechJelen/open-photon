import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { startDispatcher } from "../../../shared/server/generation/dispatcher.ts";
import { countInFlight } from "../../../shared/server/generation/generations.ts";
import { retry } from "../../../shared/server/generation/service.ts";
import { type Batch, createBatchInputSchema } from "../contracts.ts";
import { createBatch, readBatch } from "../server/batches.ts";
import { characters, motion, motionTransfer, newSession } from "./fixtures.ts";

// One place in flight (`IN_FLIGHT_MAX=1`, `./fixtures.ts`): a batch of four is larger than the
// provider's capacity, so its items wait in line and the dispatcher starts them one at a time.

const final = new Set(["done", "failed", "unknown", "cancelled"]);

/** Waits until `ready` holds, reading the database only: no event stream, no browser. */
async function until(ready: () => boolean, what: string) {
  const deadline = Date.now() + 60_000;

  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }

    await delay(20);
  }
}

function settled(id: string) {
  const batch = readBatch(id);

  return batch?.items.every((item) => final.has(item.generation.status)) ?? false;
}

function statuses(batch: Batch | null) {
  return batch?.items.map((item) => item.generation.status);
}

function admit(seeds: number[], session: { codeId: string }) {
  const { batch } = createBatch(
    motionTransfer,
    createBatchInputSchema.parse({
      shot: { character: characters[0], motion, prompt: "", seed: "default" },
      variation: { kind: "seeds", seeds },
    }),
    { requestKey: randomUUID(), session },
  );

  assert.ok(batch);

  return batch;
}

/**
 * The fake provider, failing the job of one seed (`[fake:provider_failed]`) and leaving another's
 * acceptance unknown (`[fake:ambiguous]`: Comfy takes it, the submit call times out), counting
 * submits per seed and the generations in flight at each.
 */
function scripted(failing: number, ambiguous: number) {
  const submits = new Map<number, number>();
  let inFlight = 0;

  const provider: Provider = {
    ...comfyProvider,
    submit: (graph, key) => {
      // Motion Transfer binds its seed to the sampler's `noise_seed`.
      const seed = Number(/"noise_seed":(\d+)/.exec(JSON.stringify(graph))?.[1] ?? -1);

      const scenario =
        seed === failing ? "provider_failed" : seed === ambiguous ? "ambiguous" : null;

      submits.set(seed, (submits.get(seed) ?? 0) + 1);
      inFlight = Math.max(inFlight, countInFlight());

      return comfyProvider.submit(
        scenario
          ? { ...graph, marker: { class_type: "Note", inputs: { text: `[fake:${scenario}]` } } }
          : graph,
        key,
      );
    },
  };

  return { maxInFlight: () => inFlight, provider, submits };
}

test("a batch larger than the place in flight queues and completes with no browser; a failed item leaves the others usable; an unknown one is never resubmitted", async () => {
  const { session } = newSession(20);
  const seeds = [900_101, 900_102, 900_103, 900_104];
  const { maxInFlight, provider, submits } = scripted(900_102, 900_103);
  const batch = admit(seeds, session);

  assert.deepEqual(statuses(batch), ["waiting", "waiting", "waiting", "waiting"]);

  const dispatcher = startDispatcher({ intervalMs: 20, provider });

  try {
    await until(() => settled(batch.id), "every item to finish");

    const done = readBatch(batch.id);

    assert.deepEqual(statuses(done), ["done", "failed", "unknown", "done"]);
    assert.equal(maxInFlight(), 1);

    // The completed takes keep their outputs whatever happened to the others.
    for (const position of [0, 3]) {
      const outputs = done?.items[position]?.generation.outputs.map(({ name }) => name) ?? [];

      assert.ok(outputs.includes("video") && outputs.includes("poster"), outputs.join());
    }

    assert.match(done?.items[1]?.generation.error_message ?? "", /./);
    assert.match(done?.items[2]?.generation.error_message ?? "", /never submitted again/);

    // Retry is the shared one: a failed item gets a child with a new seed, which the batch
    // follows; an unknown one is refused, and nothing ever submits it again.
    await assert.rejects(retry(done?.items[2]?.generation.id ?? "", session, provider), {
      status: 409,
    });

    const retried = await retry(done?.items[1]?.generation.id ?? "", session, provider);

    await until(
      () => readBatch(batch.id)?.items[1]?.generation.status === "done",
      "the retry to finish",
    );

    const after = readBatch(batch.id);
    const item = after?.items[1];

    assert.equal(item?.generation.id, retried.id);
    assert.equal(item?.attempt, 1);
    assert.deepEqual(item?.variation, { seed: 900_102 });
    assert.notEqual(item?.seed, 900_102);
    assert.deepEqual(statuses(after), ["done", "done", "unknown", "done"]);

    await delay(200);

    assert.deepEqual(
      seeds.map((seed) => submits.get(seed)),
      [1, 1, 1, 1],
    );
  } finally {
    await dispatcher.stop();
  }
});

const run = promisify(execFile);

test("a batch admitted before a restart is rendered by the next server process and reads the same after it", async () => {
  const { session } = newSession(20);
  const batch = admit([900_201, 900_202], session);
  const ids = batch.items.map((item) => item.generation.id);

  // Another server process on this database: it recovers, dispatches until the batch's
  // generations are final, and reports its provider submits.
  const script = `
    import { setTimeout as delay } from "node:timers/promises";
    import "./src/app/server.ts";
    import { fakeProvider } from "./src/shared/server/comfy-provider.fake.ts";
    import { recoverAfterRestart, startDispatcher } from "./src/shared/server/generation/dispatcher.ts";
    import { findGeneration } from "./src/shared/server/generation/generations.ts";
    const ids = ${JSON.stringify(ids)};
    recoverAfterRestart();
    const dispatcher = startDispatcher({ intervalMs: 20 });
    const final = ["done", "failed", "unknown", "cancelled"];
    const deadline = Date.now() + 60000;
    while (!ids.every((id) => final.includes(findGeneration(id)?.status)) && Date.now() < deadline) {
      await delay(20);
    }
    await dispatcher.stop();
    console.log(JSON.stringify({ submits: fakeProvider.calls.submit }));
  `;

  const { stdout } = await run(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", script],
    { env: process.env, timeout: 90_000 },
  );

  const report: { submits: number } = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
  const reloaded = readBatch(batch.id);

  assert.equal(report.submits, 2);
  assert.deepEqual(statuses(reloaded), ["done", "done"]);
  assert.deepEqual(
    reloaded?.items.map((item) => [item.position, item.generation.id, item.variation]),
    batch.items.map((item) => [item.position, item.generation.id, item.variation]),
  );
});
