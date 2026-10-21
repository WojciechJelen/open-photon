import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { modelsLockSchema } from "../src/features/genjutsu/workflows/models.ts";
import {
  motionTransferModels,
  motionTransferWorkflow,
} from "../src/features/genjutsu/workflows/registry.ts";

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
  assert.match(result.output, /5 model files, 5 locked, 0 missing/);
  assert.equal(motionTransferModels.length, 5);
});

test("model pin checks reject missing entries, duplicates, bad hashes and mutable URLs", () => {
  const directory = mkdtempSync(join(tmpdir(), "photon-lock-"));
  const lock = modelsLockSchema.parse(JSON.parse(readFileSync("models.lock", "utf8")));
  const first = lock.models[0];

  assert.ok(first);

  try {
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
      const path = join(directory, "models.lock");

      writeFileSync(path, JSON.stringify(mutation));
      assert.equal(run("check-models-lock", path).status, 1);
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

test("pod preflight rejects a ComfyUI installation that lacks a required class", () => {
  const directory = mkdtempSync(join(tmpdir(), "photon-preflight-"));
  const path = join(directory, "object-info.json");

  const definitions = Object.fromEntries(
    Object.values(motionTransferWorkflow.graph).map((node) => [node.class_type, {}]),
  );

  try {
    writeFileSync(path, JSON.stringify(definitions));
    assert.equal(
      run(
        "check-models-lock",
        "models.lock",
        "src/features/genjutsu/workflows/motion-transfer.v1.json",
        path,
      ).status,
      0,
    );
    delete definitions.WanAnimate2Cache;
    writeFileSync(path, JSON.stringify(definitions));

    const missing = run(
      "check-models-lock",
      "models.lock",
      "src/features/genjutsu/workflows/motion-transfer.v1.json",
      path,
    );

    assert.equal(missing.status, 1);
    assert.match(missing.output, /WanAnimate2Cache/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the installer verifies actual bytes and refuses to overwrite a mismatched file", () => {
  const directory = mkdtempSync(join(tmpdir(), "photon-install-"));
  const file = join(directory, "models", "vae", "test.safetensors");

  try {
    mkdirSync(join(directory, "models", "vae"), { recursive: true });
    writeFileSync(file, "abc");
    writeFileSync(
      join(directory, "models.lock"),
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
