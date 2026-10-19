import { z } from "zod";

import { type MotionTransferParams, motionTransferParamsSchema } from "./params.ts";

export const workflowGraphSchema = z.record(
  z.string(),
  z.object({
    _meta: z.object({ title: z.string() }).optional(),
    class_type: z.string().min(1),
    inputs: z.record(z.string(), z.json()),
  }),
);

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const inputsMapSchema = z.object({
  inputs: z.record(
    motionTransferParamsSchema.keyof(),
    z.object({ class_type: z.string().min(1), field: z.string().min(1), node: z.string().min(1) }),
  ),
  workflow: z.string().min(1),
});

export type InputsMap = z.infer<typeof inputsMapSchema>;

/** A copy of `template` with every mapped field set to its param. The template is not modified. */
export function buildGraph(
  template: WorkflowGraph,
  inputsMap: InputsMap,
  params: MotionTransferParams,
): WorkflowGraph {
  const graph = structuredClone(template);

  for (const key of motionTransferParamsSchema.keyof().options) {
    const { class_type, field, node } = inputsMap.inputs[key];
    const target = graph[node];

    if (target?.class_type !== class_type) {
      throw new Error(
        `Inputs map: ${key} expects ${class_type} at node ${node}, found ${target?.class_type ?? "no node"}`,
      );
    }

    if (!(field in target.inputs) || Array.isArray(target.inputs[field])) {
      throw new Error(`Inputs map: ${key} expects a literal field ${node}.${field}`);
    }

    target.inputs[field] = params[key];
  }

  return graph;
}
