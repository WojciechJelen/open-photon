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
import { readOutputs } from "../../../shared/server/generation/generations.ts";
import { readGeneration } from "../../../shared/server/generation/service.ts";
import { assetsDirectory } from "../../../shared/server/paths.ts";
import { generate } from "./generate.ts";
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

  const outputs = readOutputs(id);
  const compare = outputs.find(({ name }) => name === "compare")?.asset;

  assert.deepEqual(
    outputs.map(({ asset, name }) => [name, asset.id]),
    [
      ["compare", compare?.id],
      ["poster", poster?.id],
      ["video", video?.id],
    ],
  );
  // The side-by-side is stitched from the fixture result and the stored sample clip.
  assert.deepEqual(
    [compare?.source_asset_id, compare?.width, compare?.height],
    [video?.id, 1080, 1920],
  );
});
