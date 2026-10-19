import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { inputsMapSchema, workflowGraphSchema } from "./build-graph.ts";

/** Reads `workflows/<id>.v<version>.json` and its inputs map. `sha256` is the workflow file's. */
export async function loadWorkflow(id: "motion-transfer", version: 1) {
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
