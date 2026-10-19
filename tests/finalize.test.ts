import "./temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { findAsset, hashFile } from "../src/server/assets.ts";
import type { Provider, ProviderJob, ProviderOutput } from "../src/server/comfy.ts";
import { database } from "../src/server/db.server.ts";
import { finalize } from "../src/server/finalize.ts";
import {
  createGeneration,
  findGeneration,
  markQueued,
  transition,
} from "../src/server/generations.ts";
import { assetsDirectory } from "../src/server/paths.ts";
import type { Recipe } from "../src/server/recipe.ts";

let seed = 0;

function running() {
  seed += 1;

  const recipe: Recipe = {
    inputs: { driving_video_sha256: "a".repeat(64), reference_image_sha256: "b".repeat(64) },
    models: [],
    params: { fragment_length: 81, height: 848, prompt: "A dancer", seed, width: 480 },
    target: "cloud",
    workflow: { id: "motion-transfer", sha256: "c".repeat(64), version: 1 },
  };

  const { id } = markQueued(createGeneration({ recipe }).id, randomUUID());

  return transition(id, "queued", "running");
}

/** A provider whose job has `status` and, on node 246, `outputs`. */
function provider(status: string, outputs: ProviderOutput[] = []) {
  const job: ProviderJob = {
    error: null,
    events: () => {
      throw new Error("finalize never subscribes to events");
    },
    getOutputs: (nodeId) => (nodeId === "246" ? outputs : []),
    id: "provider-job",
    status,
  };

  const double: Provider = {
    job: () => Promise.resolve(job),
    submit: () => Promise.reject(new Error("finalize never submits")),
    upload: () => Promise.reject(new Error("finalize never uploads")),
  };

  return double;
}

test("a job Comfy still reports running leaves the row untouched, however old it is", async () => {
  const row = running();
  database
    .prepare("UPDATE generations SET created_at = ?, submitted_at = ? WHERE id = ?")
    .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", row.id);
  const before = findGeneration(row.id);

  assert.deepEqual(await finalize(row.id, provider("running")), before);
  assert.deepEqual(findGeneration(row.id), before);
});

test("a completed job is downloaded once, hashed, given a poster and marked done", async () => {
  const row = running();
  let downloads = 0;

  const output: ProviderOutput = {
    contentType: "video/mp4",
    name: "result.mp4",
    sizeBytes: 0,
    toFile: async (path) => {
      downloads += 1;
      await copyFile("fixtures/x.mp4", path);

      return path;
    },
  };

  const double = provider("succeeded", [output]);
  const [first, second] = await Promise.all([finalize(row.id, double), finalize(row.id, double)]);

  assert.equal(downloads, 1);
  assert.deepEqual(first, second);
  assert.equal(first?.status, "done");
  assert.equal(first?.progress, 100);
  assert.ok(first?.finished_at);
  assert.equal(first?.final_asset_id, first?.output_asset_id);

  const video = findAsset(first?.final_asset_id ?? "");
  const poster = findAsset(first?.poster_asset_id ?? "");

  assert.equal(video?.role, "provider_output");
  assert.equal(video?.sha256, await hashFile("fixtures/x.mp4"));
  assert.equal(video?.sha256, await hashFile(resolve(assetsDirectory(), video?.path ?? "")));
  assert.deepEqual(
    [poster?.role, poster?.kind, poster?.mime, poster?.width, poster?.height],
    ["poster", "poster", "image/jpeg", video?.width, video?.height],
  );
  assert.equal(poster?.sha256, await hashFile(resolve(assetsDirectory(), poster?.path ?? "")));
});
