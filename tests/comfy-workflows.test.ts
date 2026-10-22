import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverWorkflows } from "../src/shared/server/comfy-workflows.ts";
import { aggregateModelsLocks } from "../src/shared/server/models-lock.ts";

test("discoverWorkflows finds <id>.v<N>.json beside its inputs map and nothing else", () => {
  const root = mkdtempSync(join(tmpdir(), "photon-features-"));
  const workflows = join(root, "demo", "workflows");

  try {
    mkdirSync(join(workflows, "provenance"), { recursive: true });
    mkdirSync(join(root, "no-workflows"));

    for (const file of ["x.v1.json", "x.v1.inputs.json", "poc.api.json", "provenance/y.v1.json"]) {
      writeFileSync(join(workflows, file), "{}");
    }

    assert.deepEqual(discoverWorkflows(root), [
      {
        feature: "demo",
        id: "x",
        version: 1,
        workflowFile: join(workflows, "x.v1.json"),
        inputsFile: join(workflows, "x.v1.inputs.json"),
        lockFile: join(workflows, "models.lock"),
      },
    ]);

    writeFileSync(join(workflows, "z.v1.json"), "{}");
    assert.throws(() => discoverWorkflows(root), /z\.v1\.inputs\.json is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aggregateModelsLocks keeps one copy of an identical pin and names both features on a conflict", () => {
  const pin = {
    file: "shared.safetensors",
    directory: "vae" as const,
    url: `https://huggingface.co/Comfy-Org/test/resolve/${"a".repeat(40)}/vae/shared.safetensors`,
    sha256: "a".repeat(64),
    license: "Apache-2.0" as const,
  };

  const lock = (models: (typeof pin)[]) => ({ version: 1 as const, models });

  assert.deepEqual(
    aggregateModelsLocks([
      { feature: "first", lock: lock([pin]) },
      { feature: "second", lock: lock([pin]) },
    ]),
    [pin],
  );

  assert.throws(
    () =>
      aggregateModelsLocks([
        { feature: "first", lock: lock([pin]) },
        { feature: "second", lock: lock([{ ...pin, sha256: "b".repeat(64) }]) },
      ]),
    /Conflicting pins for vae\/shared\.safetensors: first and second/,
  );
});
