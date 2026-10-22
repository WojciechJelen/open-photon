import { z } from "zod";

/** A workflow in ComfyUI's API format: node id → class and inputs. */
export const workflowGraphSchema = z.record(
  z.string(),
  z.object({
    _meta: z.object({ title: z.string() }).optional(),
    class_type: z.string().min(1),
    inputs: z.record(z.string(), z.json()),
  }),
);

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
