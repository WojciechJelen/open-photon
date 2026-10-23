import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { lockedModels, workflowModelsLock } from "./models-lock.ts";
import { inputsMapSchema, workflowGraphSchema } from "./workflow-graph.ts";

/**
 * A runtime workflow: `<features>/<feature>/workflows/<id>.v<N>.json` (API format) with its
 * `<id>.v<N>.inputs.json` beside it. Its model pins are the `models.lock` in the same folder.
 */
type RuntimeWorkflow = {
  feature: string;
  id: string;
  version: number;
  workflowFile: string;
  inputsFile: string;
  /** May not exist: a graph that loads no model file needs no pins. */
  lockFile: string;
};

const RUNTIME_WORKFLOW_FILE = /^(?<id>[\w-]+)\.v(?<version>[1-9]\d*)\.json$/;

/** The runtime workflow at `workflowFile`; throws when the name or the inputs map is wrong. */
export function runtimeWorkflow(workflowFile: string): RuntimeWorkflow {
  const match = RUNTIME_WORKFLOW_FILE.exec(basename(workflowFile));

  if (!match?.groups?.id || !match.groups.version) {
    throw new Error(`${workflowFile} is not a runtime workflow (<id>.v<N>.json)`);
  }

  const { id } = match.groups;
  const version = Number(match.groups.version);
  const directory = dirname(workflowFile);
  const inputsFile = join(directory, `${id}.v${version}.inputs.json`);

  if (!existsSync(inputsFile)) {
    throw new Error(`${workflowFile} has no inputs map: ${inputsFile} is missing`);
  }

  return {
    feature: basename(dirname(directory)),
    id,
    version,
    workflowFile,
    inputsFile,
    lockFile: join(directory, "models.lock"),
  };
}

/**
 * The runtime workflow at `workflowFile` as a workflow definition uses it, read once when the
 * server starts (from the working directory, like the migrations: the files are part of the image
 * and never change while it runs): its graph, its inputs map with one entry for each of `keys`
 * (`inputsMapSchema`), the SHA-256 of the workflow file (what recipes record) and the model pins
 * new recipes carry (`lockedModels`; none for a graph that loads no model file).
 */
export function loadRuntimeWorkflow<const Key extends string>(
  workflowFile: string,
  keys: readonly Key[],
) {
  const workflow = runtimeWorkflow(workflowFile);
  const file = basename(workflowFile);
  const bytes = readFileSync(workflowFile);

  const inputsMap = inputsMapSchema(keys).parse(
    JSON.parse(readFileSync(workflow.inputsFile, "utf8")),
  );

  if (inputsMap.workflow !== file) {
    throw new Error(`${basename(workflow.inputsFile)} maps ${inputsMap.workflow}, not ${file}`);
  }

  const graph = workflowGraphSchema.parse(JSON.parse(bytes.toString("utf8")));
  const lock = workflowModelsLock(workflow, graph);

  return {
    graph,
    inputsMap,
    lockFile: workflow.lockFile,
    models: lock ? lockedModels(graph, lock) : [],
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Every runtime workflow under `root`, by feature then file name. Only files directly in a
 * feature's `workflows/` named `<id>.v<N>.json` count; nested exports, `*.api.json`, scripts and
 * READMEs do not.
 */
export function discoverWorkflows(root = "src/features") {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((feature) => {
      const directory = join(root, feature.name, "workflows");

      if (!existsSync(directory)) {
        return [];
      }

      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && RUNTIME_WORKFLOW_FILE.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => runtimeWorkflow(join(directory, entry.name)));
    });
}
