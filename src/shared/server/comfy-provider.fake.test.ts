import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { IdempotencyKeyReuse } from "@comfyorg/sdk";

import { fakeProvider } from "./comfy-provider.fake.ts";
import { providerError, providerKind } from "./comfy-provider.ts";
import type { WorkflowGraph } from "./workflow-graph.ts";

process.env.COMFY_FAKE_STEP_MS = "0";

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** A graph with one video and one image output node, and `prompt` as a text input. */
const graph = (prompt: string): WorkflowGraph => ({
  "1": { class_type: "CLIPTextEncode", inputs: { text: prompt } },
  "2": { class_type: "SaveVideo", inputs: { filename_prefix: "video" } },
  "3": { class_type: "SaveImage", inputs: { filename_prefix: "image" } },
});

test("COMFY_PROVIDER selects comfy by default and fake only outside production", () => {
  assert.equal(providerKind({}, false), "comfy");
  assert.equal(providerKind({ COMFY_PROVIDER: "fake" }, false), "fake");
  assert.throws(() => providerKind({ COMFY_PROVIDER: "fake", NODE_ENV: "production" }, false), {
    message: /production server refuses it/,
  });
  assert.throws(() => providerKind({ COMFY_PROVIDER: "fake" }, true), {
    message: /production server refuses it/,
  });
  assert.equal(providerKind({ NODE_ENV: "production" }, true), "comfy");
  assert.throws(() => providerKind({ COMFY_PROVIDER: "mock" }, false), {
    message: /must be "comfy" or "fake"/,
  });
});

test("a fake success reports progress, succeeds and outputs the fixture bytes per node class", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "open-photon-fake-"));
  t.after(() => rm(directory, { force: true, recursive: true }));

  const id = await fakeProvider.submit(graph("a dancer"), "key-success");

  // Keys are single-use: a second submit is refused as Comfy refuses it, whatever its graph, and
  // the first job keeps its scenario and outputs (checked below).
  await assert.rejects(
    fakeProvider.submit(
      { "9": { class_type: "CLIPTextEncode", inputs: { text: "[fake:provider_failed]" } } },
      "key-success",
    ),
    (error) => {
      assert.ok(error instanceof IdempotencyKeyReuse);
      assert.deepEqual([error.code, error.httpStatus], ["idempotency_key_reuse", 422]);
      assert.equal(providerError(error).code, "unknown");

      return true;
    },
  );

  const job = await fakeProvider.job(id);
  const events = [];

  for await (const event of job.events()) {
    events.push(
      event.kind === "progress" ? event.value : event.kind === "statusChange" && event.status,
    );
  }

  assert.deepEqual(events, ["running", 0.25, 0.5, 0.75, "succeeded"]);
  assert.equal(job.status, "succeeded");
  assert.deepEqual(job.getOutputs("1"), []);

  const [video] = job.getOutputs("2");
  const [image] = job.getOutputs("3");

  assert.equal(video?.contentType, "video/mp4");
  assert.equal(image?.contentType, "image/png");

  const target = join(directory, "out.mp4");
  await video?.toFile(target);

  assert.equal(await sha256(target), await sha256("tests/fixtures/fake-output.mp4"));
});

test("a [fake:provider_failed] marker fails the job; an unknown scenario throws at submit", async () => {
  const job = await fakeProvider.job(
    await fakeProvider.submit(graph("[fake:provider_failed] a dancer"), "key-failed"),
  );

  assert.equal(job.status, "failed");
  assert.equal(job.error?.code, "fake_failure");
  assert.deepEqual(job.getOutputs("2"), []);

  await assert.rejects(fakeProvider.submit(graph("[fake:nope]"), "key-nope"), {
    message: /unknown fake scenario "nope"/,
  });
});

test("an ambiguous submit is accepted by the fake, then throws an error the app cannot rule out", async () => {
  const before = fakeProvider.calls.submit;

  await assert.rejects(fakeProvider.submit(graph("[fake:ambiguous]"), "key-ambiguous"), (error) => {
    assert.deepEqual(providerError(error), {
      code: "timeout",
      message: "Comfy did not answer in time.",
      refused: false,
    });

    return true;
  });

  assert.equal(fakeProvider.calls.submit, before + 1);

  // The job exists all the same, as an accepted request would on Comfy: its id is the key's.
  const id = `fake-${createHash("sha256").update("key-ambiguous").digest("hex").slice(0, 32)}`;

  assert.equal((await fakeProvider.job(id)).status, "succeeded");
});

test("an upload is named by the file's hash", async () => {
  const reference = await fakeProvider.upload("tests/fixtures/fake-output.png");
  const hash = await sha256("tests/fixtures/fake-output.png");

  assert.deepEqual(reference, {
    __type: "core/ASSET",
    info: {
      file_path: "fake-output.png",
      hash: `sha256:${hash}`,
      id: `fake-asset-${hash.slice(0, 32)}`,
    },
  });
});
