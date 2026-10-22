import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import { fakeProvider } from "../../../shared/server/comfy-provider.fake.ts";
import { assetsDirectory } from "../../../shared/server/paths.ts";
import { generate, readGeneration } from "./generate.ts";
import { findGeneration } from "./generations.ts";
import { readSelection } from "./selection.ts";

// `comfyProvider` (the default of every call below) is the fake. The target still resolves, as
// the fake needs (`.env.example`): a self-hosted dead port, so nothing could reach a real Comfy.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

const { characters, motions } = readSelection({}, true);
const motion = motions[0]?.clip;
const character = characters[0];
const session = { codeId: findAccessCode(mintCode(100))?.id ?? "" };

assert.ok(motion && character);

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

let seed = 0;

/** A sample × sample input no other test here uses, with `prompt`. */
function input(prompt: string) {
  seed += 1;

  return { character_id: character?.id ?? "", motion_asset_id: motion?.id ?? "", prompt, seed };
}

test("COMFY_PROVIDER=fake runs a Motion Transfer generation end to end with the fixture bytes", async () => {
  const before = { ...fakeProvider.calls };
  const { id, reused } = await generate(input("A dancer"), session);

  assert.equal(reused, false);
  assert.equal(findGeneration(id)?.status, "queued");
  assert.match(findGeneration(id)?.provider_job_id ?? "", /^fake-/);

  const done = await readGeneration(id);

  assert.equal(done?.status, "done");
  assert.deepEqual(
    [fakeProvider.calls.upload - before.upload, fakeProvider.calls.submit - before.submit],
    [2, 1],
  );

  const video = findAsset(done?.final_asset_id ?? "");
  const poster = findAsset(done?.poster_asset_id ?? "");

  assert.equal(video?.sha256, await sha256("tests/fixtures/fake-output.mp4"));
  assert.equal(
    await sha256(resolve(assetsDirectory(), video?.path ?? "")),
    await sha256("tests/fixtures/fake-output.mp4"),
  );
  assert.deepEqual([video?.width, video?.height, video?.kind], [240, 424, "video"]);
  assert.equal(poster?.kind, "poster");
});

test("a provider_failed job fails the row with provider_failed", async () => {
  const { id } = await generate(input("[fake:provider_failed] A dancer"), session);
  const failed = await readGeneration(id);

  assert.deepEqual([failed?.status, failed?.error_code], ["failed", "provider_failed"]);
});

test("an ambiguous submit leaves the row unknown after exactly one submit, and never resubmits it", async () => {
  const before = fakeProvider.calls.submit;
  const same = input("[fake:ambiguous] A dancer");
  const { id } = await generate(same, session);

  assert.equal(findGeneration(id)?.status, "unknown");
  assert.equal(findGeneration(id)?.provider_job_id, null);
  assert.equal(fakeProvider.calls.submit - before, 1);

  // The same recipe again returns the unknown row; nothing is sent.
  assert.deepEqual(await generate(same, session), { id, reused: true });
  assert.equal((await readGeneration(id))?.status, "unknown");
  assert.equal(fakeProvider.calls.submit - before, 1);
});
