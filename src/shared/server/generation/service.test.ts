import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mintCode } from "../../../../tests/temp-database.ts";
import { imageDefinition, imageRecipe } from "../../../../tests/test-image-workflow.ts";
import { isPublicRequest } from "../../../app/server.ts";
import { findAccessCode } from "../access-codes.ts";
import { findAsset } from "../assets.ts";
import { fakeProvider } from "../comfy-provider.fake.ts";
import type { Provider } from "../comfy-provider.ts";
import { providerTarget } from "../comfy-target.ts";
import {
  cancelWaiting,
  createGeneration,
  findGeneration,
  findInFlight,
  markSubmitting,
  readOutputs,
} from "./generations.ts";
import { readGenerationResult, readGenerationShare } from "./pages.ts";
import { readGenerationProvenance } from "./provenance.ts";
import { readGeneration, retry, submit } from "./service.ts";

// `comfyProvider` (the default of every call below) is the fake. The target still resolves, as
// the fake needs (`.env.example`): a self-hosted dead port, so nothing could reach a real Comfy.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

const session = { codeId: findAccessCode(mintCode(100))?.id ?? "" };
const scope = { free: () => false, session };

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

test("a scalar-only workflow runs submit → done through the fake provider: no upload, one image output", async () => {
  const before = { ...fakeProvider.calls };

  const { id, reused } = await submit(
    imageDefinition,
    { prompt: "A portrait", seed: 1 },
    { scope },
  );

  const queued = findGeneration(id);

  assert.equal(reused, false);
  assert.equal(queued?.status, "queued");
  assert.equal(queued?.provider_inputs, null);
  assert.ok(queued?.submit_started_at);
  assert.deepEqual(queued?.recipe, imageRecipe("A portrait", 1));
  assert.deepEqual(
    [fakeProvider.calls.upload - before.upload, fakeProvider.calls.submit - before.submit],
    [0, 1],
  );

  const done = await readGeneration(id);

  assert.equal(done?.status, "done");
  assert.deepEqual([done?.final_asset_id, done?.poster_asset_id], [null, null]);

  const outputs = readOutputs(id);
  const image = findAsset(outputs[0]?.asset.id ?? "");

  assert.deepEqual(
    outputs.map(({ media, name }) => ({ media, name })),
    [{ media: "image", name: "image" }],
  );
  assert.equal(image?.sha256, await sha256("tests/fixtures/fake-output.png"));
  assert.deepEqual(
    [image?.kind, image?.role, image?.mime, image?.duration_ms, image?.source_asset_id],
    ["image", "provider_output", "image/png", null, null],
  );
  assert.ok(image?.width && image.height);

  // Its pages show it by its outputs, and its share page opens it to anyone.
  const result = readGenerationResult(id);
  const share = readGenerationShare(done?.share_slug ?? "", "https://photon.example");

  assert.deepEqual(result?.outputs, outputs);
  assert.deepEqual(result?.workflow, { id: "test-image", version: 1 });
  assert.equal(share?.outputs[0]?.url, `https://photon.example/media/${image?.id}.png`);
  // A workflow without `shareRecipe` shares its stored recipe as it is.
  assert.deepEqual(share?.recipe, queued?.recipe);
  assert.equal(isPublicRequest("GET", `/media/${image?.id}.png`), true);

  // The same input is the same recipe: its result comes back, nothing is sent.
  assert.deepEqual(await submit(imageDefinition, { prompt: "A portrait", seed: 1 }, { scope }), {
    id,
    reused: true,
  });
  assert.equal(fakeProvider.calls.submit - before.submit, 1);
});

test("a generation's provenance is read from its stored recipe: workflow, models, status and its definition's prompt", async () => {
  const { id } = await submit(imageDefinition, { prompt: "A portrait", seed: 1 }, { scope });
  const { workflow } = imageRecipe("A portrait", 1);

  assert.deepEqual(readGenerationProvenance(id), {
    models: [],
    prompt: "A portrait",
    status: "done",
    workflow,
  });

  // A workflow no feature registers any more still has its recorded identity, but no prompt; an
  // unknown id has no provenance.
  const gone = { ...workflow, id: "test-image-gone" };

  const { id: orphan } = createGeneration(
    { ...imageDefinition, id: gone.id },
    { recipe: { ...imageRecipe("Gone", 3), workflow: gone }, target: providerTarget() },
  );

  assert.deepEqual(readGenerationProvenance(orphan), {
    models: [],
    prompt: null,
    status: "preparing",
    workflow: gone,
  });
  assert.equal(readGenerationProvenance(crypto.randomUUID()), null);
});

test("a provider_failed job fails the row with provider_failed", async () => {
  const { id } = await submit(
    imageDefinition,
    { prompt: "[fake:provider_failed] A portrait" },
    {
      scope,
    },
  );

  const failed = await readGeneration(id);

  assert.deepEqual([failed?.status, failed?.error_code], ["failed", "provider_failed"]);
  assert.deepEqual(readOutputs(id), []);
});

test("an ambiguous submit leaves the row unknown after exactly one submit, and never resubmits it", async () => {
  const before = fakeProvider.calls.submit;
  const same = { prompt: "[fake:ambiguous] A portrait" };
  const { id } = await submit(imageDefinition, same, { scope });

  assert.equal(findGeneration(id)?.status, "unknown");
  assert.equal(findGeneration(id)?.provider_job_id, null);
  assert.equal(fakeProvider.calls.submit - before, 1);

  // The same recipe again returns the unknown row; nothing is sent.
  assert.deepEqual(await submit(imageDefinition, same, { scope }), { id, reused: true });
  assert.equal((await readGeneration(id))?.status, "unknown");
  assert.equal(fakeProvider.calls.submit - before, 1);
});

test("a scalar-only row a stopped server left mid-submit is unknown, though it uploaded nothing", async () => {
  const row = (seed: number) =>
    createGeneration(imageDefinition, {
      recipe: imageRecipe("Left behind", seed),
      target: providerTarget(),
    });

  // Stopped before the graph went out: nothing was sent, so it is back in line.
  const beforeSubmit = row(100);

  assert.deepEqual(
    [(await readGeneration(beforeSubmit.id))?.status, beforeSubmit.provider_inputs],
    ["waiting", null],
  );
  cancelWaiting(beforeSubmit.id);

  // Stopped while the provider was being asked: the job may exist there.
  const midSubmit = row(101);

  markSubmitting(midSubmit.id);

  assert.equal((await readGeneration(midSubmit.id))?.status, "unknown");
});

test("a recipe that names another workflow or version than its definition is refused before it is hashed", () => {
  const recipe = imageRecipe("Mislabelled", 1);

  assert.throws(
    () =>
      createGeneration(imageDefinition, {
        recipe: { ...recipe, workflow: { ...recipe.workflow, version: 2 } },
        target: providerTarget(),
      }),
    /names workflow test-image v2/,
  );
});

test("a job submitted to another endpoint fails target_mismatch without a call, frees its place, and a retry renders it on the current one", async () => {
  const { id } = await submit(imageDefinition, { prompt: "Elsewhere", seed: 200 }, { scope });
  const submitted = findGeneration(id);

  // The server renders on another proxy now: its COMFY_BASE_URL changed.
  const moved = { kind: "selfhost", origin: "http://10.0.0.2:8188" } as const;

  const elsewhere: Provider = {
    job: (jobId) => fakeProvider.job(jobId),
    submit: (graph, key) => fakeProvider.submit(graph, key),
    target: () => moved,
    upload: (path) => fakeProvider.upload(path),
  };

  // Its place is free on the new endpoint before anyone reads it.
  assert.ok(findInFlight(1000).includes(id));
  assert.ok(!findInFlight(1000, moved).includes(id));

  const before = { ...fakeProvider.calls };
  const read = await readGeneration(id, elsewhere);

  assert.deepEqual([read?.status, read?.error_code], ["failed", "target_mismatch"]);
  assert.equal(fakeProvider.calls.job, before.job);

  // A retry is a child submitted once to the endpoint the server renders on now.
  const child = findGeneration((await retry(id, session, elsewhere)).id);
  const parent = findGeneration(id);

  assert.equal(fakeProvider.calls.submit - before.submit, 1);
  assert.deepEqual(
    [child?.parent_id, child?.status, child?.target, child?.target_origin],
    [id, "queued", "selfhost", moved.origin],
  );
  assert.deepEqual(
    [parent?.provider_job_id, parent?.target_origin],
    [submitted?.provider_job_id, submitted?.target_origin],
  );
});
