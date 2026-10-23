import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  motionTransferModels,
  motionTransferWorkflow,
} from "../src/features/motionTransfer/workflows/registry.ts";
import { readModelsLock } from "../src/shared/server/models-lock.ts";

function run(script: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], {
    encoding: "utf8",
  });

  assert.ifError(result.error);

  return { status: result.status, output: result.stdout + result.stderr };
}

test("the workflow's five models have immutable source URLs, hashes and licenses", () => {
  const result = run("check-models-lock");

  assert.equal(result.status, 0, result.output);
  assert.match(
    result.output,
    /^motionTransfer\/motion-transfer\.v1: 5 model files, 5 locked, 0 missing \(Apache-2\.0\)$/m,
  );
  assert.equal(motionTransferModels.length, 5);
});

test("model pin checks reject missing entries, duplicates, bad hashes and mutable URLs", () => {
  const directory = mkdtempSync(join(tmpdir(), "photon-lock-"));
  const lock = readModelsLock(motionTransferWorkflow.lockFile);
  // A copy of the feature's workflows folder, so each mutated lock sits beside the workflow.
  const workflows = join(directory, "motionTransfer", "workflows");
  const workflow = join(workflows, "motion-transfer.v1.json");
  const first = lock.models[0];

  assert.ok(first);

  try {
    mkdirSync(workflows, { recursive: true });

    for (const file of ["motion-transfer.v1.json", "motion-transfer.v1.inputs.json"]) {
      copyFileSync(join(dirname(motionTransferWorkflow.lockFile), file), join(workflows, file));
    }

    const mutations = [
      { ...lock, models: lock.models.slice(1) },
      { ...lock, models: [...lock.models, first] },
      { ...lock, models: [{ ...first, sha256: "unverified" }, ...lock.models.slice(1)] },
      {
        ...lock,
        models: [
          { ...first, url: first.url.replace(/resolve\/[a-f0-9]{40}/, "resolve/main") },
          ...lock.models.slice(1),
        ],
      },
      {
        ...lock,
        models: [
          { ...first, directory: first.directory == "vae" ? "clip_vision" : "vae" },
          ...lock.models.slice(1),
        ],
      },
    ];

    for (const mutation of mutations) {
      writeFileSync(join(workflows, "models.lock"), JSON.stringify(mutation));
      assert.equal(run("check-models-lock", workflow).status, 1);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("all repository workflows pass, and the planted Higgsfield node fails by name", () => {
  const clean = run("check-open-weights");
  const planted = run("check-open-weights", "tests/fixtures/partner-node.json");

  assert.equal(clean.status, 0, clean.output);
  assert.match(clean.output, /0 forbidden/);
  assert.equal(planted.status, 1);
  assert.match(planted.output, /HiggsfieldGenjutsuMotionTransfer/);
});

test("pod preflight rejects a ComfyUI that lacks a required class or lists a file under the wrong loader", () => {
  const directory = mkdtempSync(join(tmpdir(), "photon-preflight-"));
  const path = join(directory, "object-info.json");
  const files = new Set(motionTransferModels.map(({ file }) => file));
  // The object_info below lists Motion Transfer's classes and files only, so the check runs on
  // its workflow alone, not on every feature's.
  const workflow = "src/features/motionTransfer/workflows/motion-transfer.v1.json";

  // object_info's shape: each loader offers the files it can load as its input's choices.
  const definitions = Object.fromEntries(
    Object.values(motionTransferWorkflow.graph).map(({ class_type, inputs }) => [
      class_type,
      {
        input: {
          required: Object.fromEntries(
            Object.entries(inputs).flatMap(([field, value]) =>
              typeof value === "string" && files.has(value) ? [[field, [[value], {}]]] : [],
            ),
          ),
        },
      },
    ]),
  );

  try {
    writeFileSync(path, JSON.stringify(definitions));
    assert.equal(run("check-models-lock", "--definitions", path, workflow).status, 0);

    const withoutClass = { ...definitions };

    delete withoutClass.WanAnimate2Cache;
    writeFileSync(path, JSON.stringify(withoutClass));

    const missingClass = run("check-models-lock", "--definitions", path, workflow);

    assert.equal(missingClass.status, 1);
    assert.match(missingClass.output, /WanAnimate2Cache/);

    // ComfyUI found the VAE, but under clip_vision/: the CLIP vision loader offers it, VAELoader not.
    writeFileSync(
      path,
      JSON.stringify({
        ...definitions,
        CLIPVisionLoader: {
          input: {
            required: {
              clip_name: [["clip_vision_h.safetensors", "Wan2_1_VAE_bf16.safetensors"], {}],
            },
          },
        },
        VAELoader: { input: { required: { vae_name: [[], {}] } } },
      }),
    );

    const wrongLoader = run("check-models-lock", "--definitions", path, workflow);

    assert.equal(wrongLoader.status, 1);
    assert.match(
      wrongLoader.output,
      /^motionTransfer\/motion-transfer\.v1: ComfyUI does not list Wan2_1_VAE_bf16\.safetensors for VAELoader\.vae_name; is it under .+\/vae\?$/m,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the installer verifies actual bytes and refuses to overwrite a mismatched file", () => {
  const directory = mkdtempSync(join(tmpdir(), "photon-install-"));
  const file = join(directory, "models", "vae", "test.safetensors");
  // A feature whose runtime workflow loads one file, pinned in the lock beside it.
  const workflows = join(directory, "src", "features", "demo", "workflows");

  try {
    mkdirSync(join(directory, "models", "vae"), { recursive: true });
    mkdirSync(workflows, { recursive: true });
    writeFileSync(file, "abc");
    writeFileSync(
      join(workflows, "demo.v1.json"),
      JSON.stringify({
        "1": { class_type: "VAELoader", inputs: { vae_name: "test.safetensors" } },
      }),
    );
    writeFileSync(join(workflows, "demo.v1.inputs.json"), "{}");
    writeFileSync(
      join(workflows, "models.lock"),
      JSON.stringify({
        version: 1,
        models: [
          {
            file: "test.safetensors",
            directory: "vae",
            license: "Apache-2.0",
            url: `https://huggingface.co/Comfy-Org/test/resolve/${"a".repeat(40)}/vae/test.safetensors`,
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          },
        ],
      }),
    );

    for (const contents of ["abc", "corrupt"]) {
      writeFileSync(file, contents);

      const result = spawnSync(
        process.execPath,
        [
          join(process.cwd(), "scripts/install-models.mjs"),
          join(directory, "models"),
          "--verify-only",
        ],
        { cwd: directory, encoding: "utf8" },
      );

      assert.ifError(result.error);
      assert.equal(result.status, contents === "abc" ? 0 : 1, result.stdout + result.stderr);
      assert.equal(readFileSync(file, "utf8"), contents);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a workflow that loads models without a models.lock stops the installer and the lock check", () => {
  const directory = mkdtempSync(join(tmpdir(), "photon-nolock-"));
  const workflows = join(directory, "src", "features", "demo", "workflows");
  const workflow = join(workflows, "demo.v1.json");

  try {
    mkdirSync(workflows, { recursive: true });
    writeFileSync(
      workflow,
      JSON.stringify({
        "1": { class_type: "VAELoader", inputs: { vae_name: "test.safetensors" } },
      }),
    );
    writeFileSync(join(workflows, "demo.v1.inputs.json"), "{}");

    const install = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "scripts/install-models.mjs"),
        join(directory, "models"),
        "--verify-only",
      ],
      { cwd: directory, encoding: "utf8" },
    );

    const message = /Missing models\.lock for demo\/demo\.v1: the graph loads 1 model file\(s\)/;

    assert.ifError(install.error);
    assert.equal(install.status, 1);
    assert.match(install.stderr, message);

    const check = run("check-models-lock", workflow);

    assert.equal(check.status, 1);
    assert.match(check.output, message);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the gate checks nested UI graphs and object_info metadata, and fails closed on empty or broken inputs", () => {
  const directory = mkdtempSync(join(tmpdir(), "photon-weights-"));
  const workflow = join(directory, "workflow.json");
  const definitions = join(directory, "object-info.json");

  try {
    for (const name of [
      "HiggsfieldMotion",
      "SomeApiNode",
      "KlingVideo",
      "Veo3",
      "GeminiImage",
      "RunwayVideo",
      "LumaVideo",
      "MiniMaxVideo",
      "LTXVApiNode",
    ]) {
      writeFileSync(
        workflow,
        JSON.stringify({ definitions: { subgraphs: [{ nodes: [{ id: 1, type: name }] }] } }),
      );
      const result = run("check-open-weights", workflow);

      assert.equal(result.status, 1, name);
      assert.ok(result.output.includes(name));
    }

    writeFileSync(workflow, JSON.stringify({ "1": { class_type: "UnlistedPartner", inputs: {} } }));
    writeFileSync(definitions, JSON.stringify({ UnlistedPartner: { api_node: true } }));
    assert.equal(run("check-open-weights", workflow, "--definitions", definitions).status, 1);

    writeFileSync(
      workflow,
      JSON.stringify({ "1": { class_type: "UnlistedPartner", api_node: true, inputs: {} } }),
    );
    assert.equal(run("check-open-weights", workflow).status, 1);

    for (const content of ["{}", "{bad json"]) {
      writeFileSync(workflow, content);
      assert.equal(run("check-open-weights", workflow).status, 1);
    }

    assert.equal(run("check-open-weights", join(directory, "missing")).status, 1);
    assert.equal(run("check-open-weights", workflow, "--definitions").status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
