import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  type InputsMap,
  inputsMapSchema,
  type WorkflowGraph,
  workflowGraphSchema,
} from "./build-graph.ts";
import { lockedModels, modelsLockSchema } from "./models.ts";

type LoadedWorkflow = { graph: WorkflowGraph; inputsMap: InputsMap; sha256: string };

// Resolved from the working directory, like the migrations; the Dockerfile copies it.
const WORKFLOWS_DIRECTORY = resolve("src/features/genjutsu/workflows");

/** Reads `<id>.v<version>.json` and its inputs map. `sha256` is the workflow file's. */
function readWorkflow(id: "motion-transfer", version: 1): LoadedWorkflow {
  const file = `${id}.v${version}.json`;
  const bytes = readFileSync(resolve(WORKFLOWS_DIRECTORY, file));

  const inputsMap = inputsMapSchema.parse(
    JSON.parse(readFileSync(resolve(WORKFLOWS_DIRECTORY, `${id}.v${version}.inputs.json`), "utf8")),
  );

  if (inputsMap.workflow !== file) {
    throw new Error(`${id}.v${version}.inputs.json maps ${inputsMap.workflow}, not ${file}`);
  }

  return {
    graph: workflowGraphSchema.parse(JSON.parse(bytes.toString("utf8"))),
    inputsMap,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * The motion-transfer v1 workflow, read once when the server starts (from the working directory,
 * like the migrations): the files are part of the image and never change while it runs.
 */
export const motionTransferWorkflow = readWorkflow("motion-transfer", 1);

/** Expected model hashes and licenses for new recipes. */
export const motionTransferModels = lockedModels(
  motionTransferWorkflow.graph,
  modelsLockSchema.parse(JSON.parse(readFileSync("models.lock", "utf8"))),
);
