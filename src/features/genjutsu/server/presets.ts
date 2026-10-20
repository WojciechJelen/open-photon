import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { generateInputSchema } from "../contracts.ts";

// Both files are read once when the server starts (from the working directory, like the
// workflow itself): they are part of the image and never change while it runs.

/** The reshoot-angle presets of `src/features/genjutsu/workflows/angles.json`. */
export const anglePresets = z
  .object({
    angles: z
      .array(
        z.object({
          // Appended to the prompt, so it is part of the recipe and its hash.
          fragment: z.string().min(1),
          id: z.string().regex(/^[a-z][a-z-]*$/),
          label: z.string().min(1),
        }),
      )
      .min(1),
    note: z.string(),
    // True until the angle benchmark has picked the phrasings.
    placeholder: z.boolean(),
  })
  .parse(JSON.parse(readFileSync(resolve("src/features/genjutsu/workflows/angles.json"), "utf8")));

/** `src/features/genjutsu/workflows/defaults.json`: the prompt and seed `generate` uses for a field left blank. */
export const generateDefaults = z
  .object({
    note: z.string(),
    prompt: generateInputSchema.shape.prompt.unwrap(),
    seed: generateInputSchema.shape.seed.unwrap(),
  })
  .parse(
    JSON.parse(readFileSync(resolve("src/features/genjutsu/workflows/defaults.json"), "utf8")),
  );
