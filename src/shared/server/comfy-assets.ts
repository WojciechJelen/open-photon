import { z } from "zod";

/** The `core/ASSET` reference `Asset.asReference()` returns for an uploaded file. */
export const assetReferenceSchema = z.object({
  __type: z.literal("core/ASSET"),
  info: z.object({
    file_path: z.string().optional(),
    hash: z.string().optional(),
    id: z.string().min(1),
  }),
});

export type AssetReference = z.infer<typeof assetReferenceSchema>;
