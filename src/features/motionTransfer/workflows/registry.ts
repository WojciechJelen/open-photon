import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runtimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import { lockedModels, readModelsLock } from "../../../shared/server/models-lock.ts";
import { type WorkflowGraph, workflowGraphSchema } from "../../../shared/server/workflow-graph.ts";
import { type InputsMap, inputsMapSchema } from "./build-graph.ts";

type LoadedWorkflow = {
  graph: WorkflowGraph;
  inputsMap: InputsMap;
  lockFile: string;
  sha256: string;
};

// Resolved from the working directory, like the migrations; the Dockerfile copies it.
const WORKFLOWS_DIRECTORY = resolve("src/features/motionTransfer/workflows");

/**
 * Reads `<id>.v<version>.json`, its inputs map and the path of its `models.lock`. `sha256` is the
 * workflow file's.
 */
function readWorkflow(id: "motion-transfer", version: 1): LoadedWorkflow {
  const file = `${id}.v${version}.json`;

  const { inputsFile, lockFile, workflowFile } = runtimeWorkflow(
    resolve(WORKFLOWS_DIRECTORY, file),
  );

  const bytes = readFileSync(workflowFile);
  const inputsMap = inputsMapSchema.parse(JSON.parse(readFileSync(inputsFile, "utf8")));

  if (inputsMap.workflow !== file) {
    throw new Error(`${id}.v${version}.inputs.json maps ${inputsMap.workflow}, not ${file}`);
  }

  return {
    graph: workflowGraphSchema.parse(JSON.parse(bytes.toString("utf8"))),
    inputsMap,
    lockFile,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * The motion-transfer v1 workflow, read once when the server starts (from the working directory,
 * like the migrations): the files are part of the image and never change while it runs.
 */
export const motionTransferWorkflow = readWorkflow("motion-transfer", 1);

/** Expected model hashes and licenses for new recipes, from the workflow's sibling `models.lock`. */
export const motionTransferModels = lockedModels(
  motionTransferWorkflow.graph,
  readModelsLock(motionTransferWorkflow.lockFile),
);
