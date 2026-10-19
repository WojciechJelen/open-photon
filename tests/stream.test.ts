import "./temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import test from "node:test";

import { z } from "zod";

import { generationEventSchema } from "../src/lib/contracts.ts";
import type { Provider, ProviderJob } from "../src/server/comfy.ts";
import { streamDiagnostics, streamGeneration } from "../src/server/generation-stream.ts";
import {
  createGeneration,
  findGeneration,
  markQueued,
  transition,
} from "../src/server/generations.ts";
import type { Recipe } from "../src/server/recipe.ts";

let seed = 0;

function queued() {
  seed += 1;

  const recipe: Recipe = {
    inputs: { driving_video_sha256: "a".repeat(64), reference_image_sha256: "b".repeat(64) },
    models: [],
    params: { fragment_length: 81, height: 848, prompt: "A dancer", seed, width: 480 },
    target: "cloud",
    workflow: { id: "motion-transfer", sha256: "c".repeat(64), version: 1 },
  };

  return markQueued(createGeneration({ recipe }).id, randomUUID());
}

/** A provider whose job stays subscribed until the stream aborts it; records that subscription. */
function liveProvider() {
  const subscriptions = new EventEmitter();
  const subscription = once(subscriptions, "subscribe");

  const job: ProviderJob = {
    error: null,
    async *events(signal) {
      if (!signal) {
        throw new Error("The stream must pass its AbortSignal to the subscription");
      }

      subscriptions.emit("subscribe", signal);
      await once(signal, "abort");
      yield { kind: "log", level: "info", message: "unreachable" };
    },
    getOutputs: () => [],
    id: "provider-job",
    status: "running",
  };

  const provider: Provider = {
    job: () => Promise.resolve(job),
    submit: () => Promise.reject(new Error("The stream never submits")),
    upload: () => Promise.reject(new Error("The stream never uploads")),
  };

  return {
    provider,
    subscription: subscription.then(([signal]) => z.instanceof(AbortSignal).parse(signal)),
  };
}

const unreachable: Provider = {
  job: () => Promise.reject(new Error("A finished generation must not reach Comfy")),
  submit: () => Promise.reject(new Error("The stream never submits")),
  upload: () => Promise.reject(new Error("The stream never uploads")),
};

test("a done generation produces one terminal snapshot without calling Comfy", async () => {
  const { id } = queued();
  transition(id, "queued", "finalizing");
  const row = transition(id, "finalizing", "done");

  const response = streamGeneration(new Request("http://localhost/events"), id, unreachable);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");

  const events = (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((line) => generationEventSchema.parse(JSON.parse(line.slice(6))));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.generation.id, row.id);
  assert.equal(events[0]?.generation.status, "done");
  assert.equal(streamDiagnostics().active, 0);
});

test("request abort closes the Comfy subscription and leaves the generation as it was", async () => {
  const row = queued();
  const { provider, subscription } = liveProvider();
  const controller = new AbortController();

  const response = streamGeneration(
    new Request("http://localhost/events", { signal: controller.signal }),
    row.id,
    provider,
  );

  assert.ok(response.body);
  const reader = response.body.getReader();
  await reader.read();
  const subscribed = await subscription;
  const before = streamDiagnostics().requestAborts;
  controller.abort();

  assert.equal((await reader.read()).done, true);
  assert.equal(subscribed.aborted, true);
  assert.equal(streamDiagnostics().requestAborts, before + 1);
  assert.equal(streamDiagnostics().active, 0);
  assert.equal(findGeneration(row.id)?.status, "queued");
});

test("a request aborted before the stream starts opens no subscription", async () => {
  const controller = new AbortController();
  controller.abort();

  const response = streamGeneration(
    new Request("http://localhost/events", { signal: controller.signal }),
    queued().id,
    unreachable,
  );

  assert.equal(await response.text(), "");
  assert.equal(streamDiagnostics().active, 0);
});

test("a consumer cancelling the body closes the Comfy subscription", async () => {
  const { provider, subscription } = liveProvider();
  const response = streamGeneration(new Request("http://localhost/events"), queued().id, provider);

  assert.ok(response.body);
  const reader = response.body.getReader();
  await reader.read();
  const subscribed = await subscription;
  await reader.cancel();

  assert.equal((await reader.read()).done, true);
  assert.equal(subscribed.aborted, true);
  assert.equal(streamDiagnostics().active, 0);
});
