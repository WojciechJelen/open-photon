import { resolve } from "node:path";

import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";

// Read once when the server starts, from the working directory, like the character builder's;
// both Dockerfiles copy every feature's `workflows/`. Kept apart from the definitions, which open
// the database, so a script can build or hash the graphs without one.

/** The graph params of both edit workflows: the scalars and one `LoadImage` per reference. */
export const EDIT_PARAMS = [
  "prompt",
  "seed",
  "width",
  "height",
  "reference_1",
  "reference_2",
  "reference_3",
] as const;

/** The reference params, in order: `reference_<n>` is `LoadImage` `11`, `12`, `13`. */
export const REFERENCE_PARAMS = ["reference_1", "reference_2", "reference_3"] as const;

/** `image-edit.v1.json`: FLUX 3 Image Klein distilled, the prompt as given (`workflows/README.md`). */
export const imageEditWorkflow = loadRuntimeWorkflow(
  resolve("src/features/imageEdit/workflows/image-edit.v1.json"),
  EDIT_PARAMS,
);

/** `image-edit-enhanced.v1.json`: the same edit after FLUX 3's prompt upsampler (`workflows/README.md`). */
export const imageEditEnhancedWorkflow = loadRuntimeWorkflow(
  resolve("src/features/imageEdit/workflows/image-edit-enhanced.v1.json"),
  EDIT_PARAMS,
);
