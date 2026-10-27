import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lockedModels, readModelsLock } from "./models-lock.ts";

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

const lightning = `https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/${revision}/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`;

/** A lock of the one Lightning LoRA pin, with `url` and `directory`. */
function loraLock(directory: string, url: string, pinDirectory = "loras") {
  const path = join(directory, "models.lock");
  const file = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors";

  writeFileSync(
    path,
    JSON.stringify({
      models: [
        { directory: pinDirectory, file, license: "Apache-2.0", sha256: "c".repeat(64), url },
      ],
      version: 1,
    }),
  );

  return () => readModelsLock(path);
}

const loraGraph = {
  "1": {
    class_type: "LoraLoaderModelOnly",
    inputs: {
      lora_name: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
      model: ["2", 0],
      strength_model: 1,
    },
  },
};

test("two LoRA repositories outside Comfy-Org are allowed by id, their root files installed under loras", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "open-photon-lock-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  const angles = `https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA/resolve/${revision}/qwen-image-edit-2511-multiple-angles-lora.safetensors`;
  const lock = loraLock(directory, lightning)();

  assert.equal(lock.models[0]?.url, lightning);
  assert.deepEqual(lockedModels(loraGraph, lock), [
    {
      file: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
      license: "Apache-2.0",
      sha256: "c".repeat(64),
    },
  ]);
  assert.equal(loraLock(directory, angles)().models[0]?.url, angles);

  // Another repository of the same organisations, a branch, or another install directory are not.
  assert.throws(
    loraLock(
      directory,
      `https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/${revision}/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`,
    ),
  );
  assert.throws(
    loraLock(
      directory,
      `https://huggingface.co/fal/Qwen-Image-Edit-2509-Multiple-Angles-LoRA/resolve/${revision}/qwen-image-edit-2511-multiple-angles-lora.safetensors`,
    ),
  );
  assert.throws(
    loraLock(
      directory,
      "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    ),
  );
  assert.throws(
    () => lockedModels(loraGraph, loraLock(directory, lightning, "diffusion_models")()),
    /does not match its install path/,
  );
});

/** A lock of one pin with `directory`, `url` and `license`. */
function pinLock(directory: string, pin: { directory: string; license: string; url: string }) {
  const path = join(directory, "models.lock");

  writeFileSync(
    path,
    JSON.stringify({
      models: [{ ...pin, file: "birefnet.safetensors", sha256: "d".repeat(64) }],
      version: 1,
    }),
  );

  return () => readModelsLock(path);
}

test("an MIT background_removal model is allowed only from Comfy-Org/BiRefNet's background_removal/", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "open-photon-lock-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  const birefnet = `https://huggingface.co/Comfy-Org/BiRefNet/resolve/${revision}/background_removal/birefnet.safetensors`;

  const lock = pinLock(directory, {
    directory: "background_removal",
    license: "MIT",
    url: birefnet,
  })();

  const graph = {
    "1": {
      class_type: "LoadBackgroundRemovalModel",
      inputs: { bg_removal_name: "birefnet.safetensors" },
    },
  };

  assert.deepEqual(lockedModels(graph, lock), [
    { file: "birefnet.safetensors", license: "MIT", sha256: "d".repeat(64) },
  ]);

  // MIT or background_removal from any other repository or directory is refused.
  const elsewhere = `https://huggingface.co/Comfy-Org/Other/resolve/${revision}/background_removal/birefnet.safetensors`;

  assert.throws(
    pinLock(directory, { directory: "background_removal", license: "MIT", url: elsewhere }),
  );
  assert.throws(
    pinLock(directory, {
      directory: "vae",
      license: "MIT",
      url: `https://huggingface.co/Comfy-Org/Other/resolve/${revision}/vae/birefnet.safetensors`,
    }),
  );
  assert.throws(
    pinLock(directory, { directory: "background_removal", license: "Apache-2.0", url: elsewhere }),
  );
});
