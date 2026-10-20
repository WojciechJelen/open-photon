import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  type InputsMap,
  inputsMapSchema,
  type WorkflowGraph,
  workflowGraphSchema,
} from "./build-graph.ts";

export type LoadedWorkflow = { graph: WorkflowGraph; inputsMap: InputsMap; sha256: string };

/** Reads `workflows/<id>.v<version>.json` and its inputs map. `sha256` is the workflow file's. */
export async function loadWorkflow(id: "motion-transfer", version: 1): Promise<LoadedWorkflow> {
  const file = `${id}.v${version}.json`;

  const [bytes, map] = await Promise.all([
    readFile(resolve("workflows", file)),
    readFile(resolve("workflows", `${id}.v${version}.inputs.json`), "utf8"),
  ]);

  const inputsMap = inputsMapSchema.parse(JSON.parse(map));

  if (inputsMap.workflow !== file) {
    throw new Error(
      `workflows/${id}.v${version}.inputs.json maps ${inputsMap.workflow}, not ${file}`,
    );
  }

  return {
    graph: workflowGraphSchema.parse(JSON.parse(bytes.toString("utf8"))),
    inputsMap,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * The model files a graph loads: every loader field (`unet_name`, `lora_name`, `clip_name`,
 * `vae_name`, …) that names a weights file, in graph order, each once. Until `models.lock` pins
 * them with hashes and licenses (Step 8.1), these names are all a recipe can say about its models.
 */
export function workflowModelFiles(graph: WorkflowGraph) {
  const files = Object.values(graph).flatMap(({ inputs }) =>
    Object.entries(inputs).flatMap(([field, value]) => {
      const file = z.string().safeParse(value);

      return field.endsWith("_name") &&
        file.success &&
        /\.(safetensors|ckpt|pt|pth|bin|gguf)$/.test(file.data)
        ? [file.data]
        : [];
    }),
  );

  return [...new Set(files)];
}
