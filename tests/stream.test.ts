import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { jobEventSchema } from "../src/lib/contracts.ts";
import { findJob, insertJob, updateJob } from "../src/server/db.server.ts";
import { streamDiagnostics, streamJob } from "../src/server/job-stream.server.ts";

const directory = mkdtempSync(join(tmpdir(), "comfy-stream-"));

process.env.DATABASE_PATH = join(directory, "test.sqlite");

after(() => rmSync(directory, { force: true, recursive: true }));

function job() {
  return insertJob({
    id: randomUUID(),
    preset: "portrait",
    prompt: "Test",
    take: 1,
  }).job;
}

function completed() {
  const row = job();

  return updateJob(row.id, (current) => ({
    ...current,
    completedAt: 1000,
    message: "Saved",
    output: {
      assetId: "asset-test",
      bytes: 86_526,
      durationSeconds: 3,
      filename: `${row.id}.mp4`,
      height: 180,
      posterFilename: `${row.id}.jpg`,
      sha256: "0".repeat(64),
      width: 320,
    },
    percent: 100,
    providerJobId: `provider-${row.id}`,
    status: "complete",
  }));
}

test("a completed persisted render produces one terminal snapshot without calling Comfy", async () => {
  const row = completed();
  const response = streamJob(new Request("http://localhost/events"), row.id);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.match(response.headers.get("cache-control") ?? "", /no-cache/);

  const events = (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((line) => jobEventSchema.parse(JSON.parse(line.slice(6))));

  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.job, row);
  assert.equal(streamDiagnostics().active, 0);
});

test("request abort closes the live subscription while leaving the render persisted", async () => {
  const row = job(),
    controller = new AbortController();

  const response = streamJob(
    new Request("http://localhost/events", { signal: controller.signal }),
    row.id,
  );

  assert.ok(response.body);
  const reader = response.body.getReader();
  await reader.read();
  const before = streamDiagnostics().requestAborts;
  controller.abort();
  assert.equal((await reader.read()).done, true);
  assert.equal(streamDiagnostics().requestAborts, before + 1);
  assert.equal(streamDiagnostics().active, 0);
  assert.equal(findJob(row.id)?.status, "submitting");
});

test("pre-aborted requests have no active subscription", async () => {
  const controller = new AbortController();
  controller.abort();

  const response = streamJob(
    new Request("http://localhost/events", { signal: controller.signal }),
    job().id,
  );

  assert.equal(await response.text(), "");
  assert.equal(streamDiagnostics().active, 0);
});

test("consumer cancellation closes the generator", async () => {
  const response = streamJob(new Request("http://localhost/events"), job().id);
  assert.ok(response.body);
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal((await reader.read()).done, true);
  assert.equal(streamDiagnostics().active, 0);
});

test("elapsed time cannot finalize a provider render", () => {
  const row = job();
  updateJob(row.id, (current) => ({
    ...current,
    completedAt: null,
    createdAt: "2000-01-01T00:00:00.000Z",
    percent: 50,
    providerJobId: "provider-persisted",
    status: "running",
  }));
  assert.equal(findJob(row.id)?.status, "running");
  assert.equal(findJob(row.id)?.percent, 50);
  assert.equal(findJob(row.id)?.providerJobId, "provider-persisted");
});

test("repeated request IDs reuse the existing row and reject different inputs", () => {
  const row = job();
  assert.equal(insertJob(row).created, false);
  assert.throws(() => insertJob({ ...row, prompt: "different" }), /different inputs/);
  assert.deepEqual(findJob(row.id), row);
});

test("completion is durable and cannot regress to running", () => {
  const row = completed();

  const again = updateJob(row.id, (current) => ({
    ...current,
    completedAt: null,
    percent: 50,
    providerJobId: `provider-${row.id}`,
    status: "running",
  }));

  assert.deepEqual(again, row);
  assert.deepEqual(findJob(row.id), row);
});
