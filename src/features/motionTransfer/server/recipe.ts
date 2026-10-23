import { z } from "zod";

import { motionTransferParamsSchema } from "../workflows/params.ts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Everything that determines a render, and nothing else: no timestamps, ids, keys or URLs.
 * Strict objects, so a stray field fails instead of silently changing (or not changing) the hash
 * (`recipeHash`, `src/shared/server/generation/recipe-hash.ts`).
 */
export const recipeSchema = z.strictObject({
  // The reshoot-angle preset whose phrasing `params.prompt` ends with, on takes made before the
  // angle benchmark (`docs/angle-benchmark-2026-10-23/`) removed the presets. Kept so their
  // stored recipes still parse and hash as they did; new recipes have none.
  angle: z
    .string()
    .regex(/^[a-z][a-z-]*$/)
    .optional(),
  inputs: z.strictObject({
    driving_video_sha256: sha256Schema,
    reference_image_sha256: sha256Schema,
  }),
  // Expected model pins from models.lock; older recipes retain their empty list.
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  // The provider's asset references differ per upload; the input hashes above identify the files.
  params: z.strictObject(
    motionTransferParamsSchema.omit({ driving_video: true, reference_image: true }).shape,
  ),
  target: z.enum(["cloud", "selfhost"]),
  workflow: z.strictObject({
    id: z.string().min(1),
    sha256: sha256Schema,
    version: z.int().positive(),
  }),
});

export type Recipe = z.infer<typeof recipeSchema>;
