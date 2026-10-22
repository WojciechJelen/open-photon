import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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
