import { resolve } from "node:path";

import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";

// Read once when the server starts, from the working directory, like Motion Transfer's; both
// Dockerfiles copy every feature's `workflows/`. Kept apart from the definitions, which open the
// database, so a script can read the workflow files' hashes and model pins without one.

/**
 * `character-generation.v1.json` (FLUX 3 Image Klein distilled, int8, `workflows/README.md`) with
 * its inputs map and model pins.
 */
export const characterImageWorkflow = loadRuntimeWorkflow(
  resolve("src/features/characterBuilder/workflows/character-generation.v1.json"),
  ["caption", "height", "seed", "width"],
);

/**
 * `character-caption.v1.json`: FLUX 3 Image Klein's prompt upsampler alone (`workflows/README.md`),
 * with its inputs map and model pins.
 */
export const characterCaptionWorkflow = loadRuntimeWorkflow(
  resolve("src/features/characterBuilder/workflows/character-caption.v1.json"),
  ["request", "seed"],
);
