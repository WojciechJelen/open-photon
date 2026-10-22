import { z } from "zod";

import { motionTransferParamsSchema } from "../workflows/params.ts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Everything that determines a render, and nothing else: no timestamps, ids, keys or URLs.
 * Strict objects, so a stray field fails instead of silently changing (or not changing) the hash
 * (`recipeHash`, `src/shared/server/generation/recipe-hash.ts`).
 */
export const recipeSchema = z.strictObject({
  // The reshoot-angle preset (`src/features/motionTransfer/workflows/angles.json`) whose phrasing `params.prompt` ends with.
  // Absent without one, so a recipe that has no angle hashes as it did before angles existed.
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
