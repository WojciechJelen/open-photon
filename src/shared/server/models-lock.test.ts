import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readModelsLock } from "./models-lock.ts";

const revision = "a".repeat(40);

/** Reads a lock of one pin with `url` and `license`. */
function lockWith(directory: string, url: string, license: string) {
  const path = join(directory, "models.lock");

  writeFileSync(
    path,
    JSON.stringify({
      models: [
        { directory: "vae", file: "flux2-vae.safetensors", license, sha256: "b".repeat(64), url },
      ],
      version: 1,
    }),
  );

  return () => readModelsLock(path);
}

test("a pin may come from a Comfy-Org repackaging or from BFL's FLUX 3 Image Klein repository, under Apache-2.0 or FLUX Kommunity", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "open-photon-lock-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  const bfl = `https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/${revision}/vae/flux2-vae.safetensors`;
  const comfy = `https://huggingface.co/Comfy-Org/flux2-klein/resolve/${revision}/vae/flux2-vae.safetensors`;

  assert.equal(lockWith(directory, bfl, "FLUX-Kommunity-1.0")().models[0]?.url, bfl);
  assert.equal(lockWith(directory, comfy, "Apache-2.0")().models[0]?.license, "Apache-2.0");

  // Another repository, a branch instead of a commit, or another licence are refused.
  assert.throws(
    lockWith(
      directory,
      `https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/${revision}/vae/x.safetensors`,
      "Apache-2.0",
    ),
  );
  assert.throws(
    lockWith(
      directory,
      "https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/resolve/main/vae/flux2-vae.safetensors",
      "FLUX-Kommunity-1.0",
    ),
  );
  assert.throws(lockWith(directory, bfl, "FLUX-1-dev-non-commercial"));
});
