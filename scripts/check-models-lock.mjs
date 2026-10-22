// Checks every model file a runtime workflow loads against its feature's models.lock:
//   node scripts/check-models-lock.mjs [--definitions <object_info.json>] [<workflow.json> ...]
// No workflow = every runtime workflow under src/features. With --definitions (ComfyUI's
// /object_info), also checks that ComfyUI has every node class the workflow uses and that each
// loader field lists the file the workflow gives it among its choices (so ComfyUI found the file in
// that loader's models directory). Prints one line per workflow, then checks the feature locks
// agree on every shared file. Exits 1 on any failure.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { z } from "zod";

import { discoverWorkflows, runtimeWorkflow } from "../src/shared/server/comfy-workflows.ts";
import {
  aggregateModelsLocks,
  lockedModels,
  workflowModelReferences,
  workflowModelsLock,
} from "../src/shared/server/models-lock.ts";
import { workflowGraphSchema } from "../src/shared/server/workflow-graph.ts";

// A loader input's choices in object_info: `[["a.safetensors", …], {…}]`, or
// `["COMBO", { options: [...] }]` for nodes on ComfyUI's newer schema. Other inputs offer none.
const choicesSchema = z.union([
  z.tuple([z.array(z.string())], z.unknown()).transform(([choices]) => choices),
  z
    .tuple([z.literal("COMBO"), z.object({ options: z.array(z.string()) }).loose()], z.unknown())
    .transform(([, { options }]) => options),
]);

const inputsSchema = z.record(z.string(), z.unknown()).optional();

const definitionsSchema = z.record(
  z.string(),
  z
    .object({
      input: z.object({ required: inputsSchema, optional: inputsSchema }).loose().optional(),
    })
    .loose(),
);

let failed = false;

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { definitions: { type: "string" } },
  });

  const workflows = positionals.length ? positionals.map(runtimeWorkflow) : discoverWorkflows();

  if (!workflows.length) {
    throw new Error("No runtime workflows (<id>.v<N>.json) under src/features");
  }

  const definitions =
    values.definitions &&
    definitionsSchema.parse(JSON.parse(readFileSync(values.definitions, "utf8")));

  // Each feature lock that read cleanly, for the cross-feature check at the end.
  const locks = new Map();

  for (const workflow of workflows) {
    const label = `${workflow.feature}/${workflow.id}.v${workflow.version}`;
    // A Set: a file two nodes load through the same loader field is one problem.
    const problems = new Set();

    try {
      const graph = workflowGraphSchema.parse(
        JSON.parse(readFileSync(workflow.workflowFile, "utf8")),
      );

      // A graph that loads no model file needs no lock; one that does without a lock throws.
      const lock = workflowModelsLock(workflow, graph);

      if (lock) {
        locks.set(workflow.lockFile, { feature: workflow.feature, lock });
      }

      const models = lock ? lockedModels(graph, lock) : [];

      if (definitions) {
        const missing = [...new Set(Object.values(graph).map((node) => node.class_type))].filter(
          (name) => !(name in definitions),
        );

        if (missing.length) {
          problems.add(`ComfyUI is missing node definitions: ${missing.join(", ")}`);
        }

        // Each file against the choices of the loader field that names it: a file ComfyUI found
        // under another loader's directory does not count.
        for (const { file, class_type, field } of workflowModelReferences(graph)) {
          const input = definitions[class_type]?.input;

          if (!input) {
            continue;
          }

          const choices = choicesSchema.safeParse(
            input.required?.[field] ?? input.optional?.[field],
          );

          if (!choices.success || !choices.data.includes(file)) {
            const directory = lock?.models.find((model) => model.file === file)?.directory;

            problems.add(
              `ComfyUI does not list ${file} for ${class_type}.${field}; is it under ${process.env.MODELS_DIR ?? "ComfyUI's models directory"}${directory ? `/${directory}` : ""}?`,
            );
          }
        }
      }

      if (!problems.size) {
        console.log(`${label}: ${models.length} model files, ${models.length} locked, 0 missing`);
      }
    } catch (error) {
      problems.add(error.message);
    }

    for (const problem of problems) {
      console.error(`${label}: ${problem}`);
    }

    failed ||= problems.size > 0;
  }

  // What install-models.mjs installs: a file two features pin differently fails here, in CI,
  // rather than at pod boot.
  const pinned = aggregateModelsLocks([...locks.values()]);

  if (!failed) {
    console.log(
      `${pinned.length} distinct model files across ${locks.size} feature ${locks.size === 1 ? "lock" : "locks"}, 0 conflicts`,
    );
  }
} catch (error) {
  console.error(error.message);
  failed = true;
}

if (failed) {
  process.exitCode = 1;
}
