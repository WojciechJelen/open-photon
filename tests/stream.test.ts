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

/** Comfy at a dead port: every call fails the way Node's fetch does. */
const dead: Provider = {
  job: () => Promise.reject(new TypeError("fetch failed")),
  submit: () => Promise.reject(new TypeError("fetch failed")),
  upload: () => Promise.reject(new TypeError("fetch failed")),
};

/** The events of a whole stream body: each event's `id` and `retry` fields and its parsed data. */
function parseEvents(body: string) {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const fields = new Map(
        block.split("\n").map((line) => {
          const [name = "", ...value] = line.split(":");

          return [name, value.join(":").trimStart()];
        }),
      );

      return {
        data: generationEventSchema.parse(JSON.parse(fields.get("data") ?? "")),
        id: fields.get("id"),
        retry: fields.get("retry"),
      };
    });
}

test("a done generation produces one terminal snapshot without calling Comfy", async () => {
  const { id } = queued();
  transition(id, "queued", "finalizing");
  const row = transition(id, "finalizing", "done");

  const response = streamGeneration(new Request("http://localhost/events"), id, unreachable);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");

  const events = parseEvents(await response.text());

  assert.equal(events.length, 1);
  assert.equal(events[0]?.data.generation.id, row.id);
  assert.equal(events[0]?.data.generation.status, "done");
  assert.equal(streamDiagnostics().active, 0);
});

test("with Comfy unreachable the stored snapshot still comes first, then a notice and a clean end with a growing retry delay", async () => {
  const row = queued();

  for (const [lastEventId, id, retry] of [
    [null, "provider-unavailable:1", "5000"],
    ["provider-unavailable:2", "provider-unavailable:3", "20000"],
    ["provider-unavailable:9", "provider-unavailable:10", "60000"],
  ]) {
    const headers = lastEventId ? { "Last-Event-ID": lastEventId } : undefined;

    const response = streamGeneration(
      new Request("http://localhost/events", { headers }),
      row.id,
      dead,
    );

    assert.equal(response.status, 200);

    // `text()` rejects if the stream ends in an error rather than closing.
    const events = parseEvents(await response.text());

    assert.deepEqual(
      events.map(({ data }) => [data.kind, data.generation.status]),
      [
        ["snapshot", "queued"],
        ["provider_unavailable", "queued"],
      ],
    );
    // The snapshot clears the browser's last event id; the notice counts the failure.
    assert.deepEqual(
      events.map((event) => [event.id, event.retry]),
      [
        ["", undefined],
        [id, retry],
      ],
    );
  }

  assert.equal(findGeneration(row.id)?.status, "queued");
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
