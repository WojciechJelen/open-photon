import { z } from "zod";

/** `/product-studio`'s search: the shoot shown beside the form, so a reload follows it. */
export const studioSearchSchema = z.object({ shoot: z.uuid().optional().catch(undefined) });

export type StudioSearch = z.output<typeof studioSearchSchema>;
