import { readFileSync } from "node:fs";

import { z } from "zod";

import { workflowGraphSchema } from "../src/features/genjutsu/workflows/build-graph.ts";
import { lockedModels, modelsLockSchema } from "../src/features/genjutsu/workflows/models.ts";

try {
  const [
    lockFile = "models.lock",
    workflow = "src/features/genjutsu/workflows/motion-transfer.v1.json",
    definitionsFile,
  ] = process.argv.slice(2);

  const lock = modelsLockSchema.parse(JSON.parse(readFileSync(lockFile, "utf8")));
  const graph = workflowGraphSchema.parse(JSON.parse(readFileSync(workflow, "utf8")));
  const models = lockedModels(graph, lock);

  if (definitionsFile) {
    const definitions = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(definitionsFile, "utf8")));

    const missing = [...new Set(Object.values(graph).map((node) => node.class_type))].filter(
      (name) => !(name in definitions),
    );

    if (missing.length)
      throw new Error(`ComfyUI is missing node definitions: ${missing.join(", ")}`);
  }

  console.log(`${models.length} model files, ${models.length} locked, 0 missing`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
