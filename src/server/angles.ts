import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

const anglesSchema = z.object({
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
});

/** The reshoot-angle presets of `workflows/angles.json` (read from the working directory). */
export async function loadAngles() {
  return anglesSchema.parse(JSON.parse(await readFile(resolve("workflows/angles.json"), "utf8")));
}
