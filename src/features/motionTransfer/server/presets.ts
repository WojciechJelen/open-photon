import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { generateInputSchema } from "../contracts.ts";

/**
 * `src/features/motionTransfer/workflows/defaults.json`: the prompt and seed `generate` uses for a
 * field left blank. Read once when the server starts (from the working directory, like the
 * workflow itself): it is part of the image and never changes while it runs.
 */
export const generateDefaults = z
  .object({
    note: z.string(),
    prompt: generateInputSchema.shape.prompt.unwrap(),
    seed: generateInputSchema.shape.seed.unwrap(),
  })
  .parse(
    JSON.parse(
      readFileSync(resolve("src/features/motionTransfer/workflows/defaults.json"), "utf8"),
    ),
  );
