import { z } from "zod";

/** The `core/ASSET` reference `Asset.asReference()` returns for an uploaded file. */
const assetReferenceSchema = z.object({
  __type: z.literal("core/ASSET"),
  info: z.object({
    file_path: z.string().optional(),
    hash: z.string().optional(),
    id: z.string().min(1),
  }),
});

export const motionTransferParamsSchema = z.object({
  driving_video: assetReferenceSchema,
  frames: z.int().positive(),
  height: z.int().positive(),
  prompt: z.string(),
  reference_image: assetReferenceSchema,
  seed: z.int().nonnegative(),
  width: z.int().positive(),
});

export type MotionTransferParams = z.infer<typeof motionTransferParamsSchema>;
