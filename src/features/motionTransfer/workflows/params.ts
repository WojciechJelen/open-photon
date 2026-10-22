import { z } from "zod";

import { assetReferenceSchema } from "../../../shared/server/comfy-assets.ts";

export const motionTransferParamsSchema = z.object({
  driving_video: assetReferenceSchema,
  // The template splits the driving clip into windows of this many frames: 672:636 divides by
  // (fragment_length - 1), and Wan's temporal latent holds ((length - 1) // 4) + 1 frames, so
  // only 4n + 1 lengths render whole windows. 81 (5 s at 16 fps) is the template default and the
  // clip length Wan was trained on; longer windows are untested and cost more GPU memory.
  fragment_length: z
    .int()
    .min(5)
    .max(81)
    .refine((value) => value % 4 === 1, "fragment_length must be 4n + 1"),
  height: z.int().positive(),
  prompt: z.string(),
  reference_image: assetReferenceSchema,
  seed: z.int().nonnegative(),
  width: z.int().positive(),
});

export type MotionTransferParams = z.infer<typeof motionTransferParamsSchema>;
