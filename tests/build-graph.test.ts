import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildGraph,
  type WorkflowGraph,
  workflowGraphSchema,
} from "../src/features/motionTransfer/workflows/build-graph.ts";
import { motionTransferParamsSchema } from "../src/features/motionTransfer/workflows/params.ts";
import { motionTransferWorkflow } from "../src/features/motionTransfer/workflows/registry.ts";

const { graph: template, inputsMap } = motionTransferWorkflow;

// The graph the spike submitted for work/wan-run.json (portrait, take 1), written by a one-off
// WAN_DRY_RUN of scripts/run-wan.mjs with stand-in asset references instead of uploads.
const spikeGraph = workflowGraphSchema.parse(
  JSON.parse(await readFile("tests/fixtures/spike-submitted-graph.json", "utf8")),
);

const spikeParams = motionTransferParamsSchema.parse({
  driving_video: spikeGraph["240"]?.inputs.file,
  fragment_length: 81,
  height: 854,
  prompt:
    "Character Description: Cartoon character lost. Background description: The background is an empty white room.",
  reference_image: spikeGraph["189"]?.inputs.image,
  seed: 582_699_151_003_550,
  width: 482,
});

function fields(graph: WorkflowGraph): Array<[string, string]> {
  return Object.entries(graph).flatMap(([id, node]) =>
    Object.entries(node.inputs).map(([field, value]) => [`${id}.${field}`, JSON.stringify(value)]),
  );
}

test("buildGraph reproduces the graph the spike submitted", () => {
  const expected = Object.fromEntries(
    Object.entries(spikeGraph)
      // v1 dropped the comparison output 292 and the 291:* nodes only it reached.
      .filter(([id]) => id !== "292" && !id.startsWith("291:"))
      // The spike named its output after the job; v1 keeps the template's prefix, because the
      // app collects the output by node, not by name.
      .map(([id, node]) =>
        id === "246"
          ? [id, { ...node, inputs: { ...node.inputs, filename_prefix: "video/ComfyUI" } }]
          : [id, node],
      ),
  );

  assert.deepEqual(buildGraph(template, inputsMap, spikeParams), expected);
});

test("changing one param changes exactly one field", () => {
  const before = new Map(fields(buildGraph(template, inputsMap, spikeParams)));
  const after = fields(buildGraph(template, inputsMap, { ...spikeParams, seed: 7 }));
  const changed = after.filter(([path, value]) => before.get(path) !== value);

  assert.equal(after.length, before.size);
  assert.deepEqual(changed, [["672:597.noise_seed", "7"]]);
});

test("buildGraph leaves the template unchanged", () => {
  const snapshot = structuredClone(template);

  buildGraph(template, inputsMap, { ...spikeParams, prompt: "a different prompt" });

  assert.deepEqual(template, snapshot);
});

test("a map entry pointing at a missing node throws", () => {
  const broken = {
    ...inputsMap,
    inputs: { ...inputsMap.inputs, seed: { ...inputsMap.inputs.seed, node: "999" } },
  };

  assert.throws(
    () => buildGraph(template, broken, spikeParams),
    /seed expects SamplerCustom at node 999/,
  );
});

test("the params schema rejects fragment lengths the template cannot window", () => {
  // 1 makes 672:636 divide by zero; 6 is not 4n + 1; 85 is past the supported window.
  for (const fragment_length of [1, 6, 85]) {
    assert.equal(
      motionTransferParamsSchema.safeParse({ ...spikeParams, fragment_length }).success,
      false,
      `fragment_length ${fragment_length}`,
    );
  }
});

test("the params schema rejects a fractional seed", () => {
  assert.equal(motionTransferParamsSchema.safeParse({ ...spikeParams, seed: 1.5 }).success, false);
});
