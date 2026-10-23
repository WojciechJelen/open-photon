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

/** A value a graph's node input holds. */
export type GraphValue = WorkflowGraph[string]["inputs"][string];

/** Where one input of a workflow goes: the literal `field` of `node`, which must be a `class_type`. */
const inputBindingSchema = z.object({
  class_type: z.string().min(1),
  field: z.string().min(1),
  node: z.string().min(1),
});

/**
 * The schema of a runtime workflow's inputs map (`<id>.v<N>.inputs.json`): exactly one entry
 * for each of `keys`, the values the workflow's definition fills in (scalar params such as a
 * prompt or a seed, and the provider's references to uploaded files), and the workflow file it
 * maps. An entry is one binding, or a list of them when several nodes read the same value (an
 * image size both the latent and the scheduler take as a literal); each gets the value.
 */
export function inputsMapSchema<const Key extends string>(keys: readonly Key[]) {
  return z.object({
    inputs: z.record(
      z.enum(keys),
      z.union([inputBindingSchema, z.array(inputBindingSchema).min(1)]),
    ),
    workflow: z.string().min(1),
  });
}

type InputBinding = z.infer<typeof inputBindingSchema>;

/** A param's entry in an inputs map: one binding, or several fields that take its value. */
type InputEntry = InputBinding | readonly InputBinding[];

export type InputsMap<Key extends string = string> = {
  inputs: Readonly<Record<Key, InputEntry>>;
  workflow: string;
};

/**
 * A copy of `template` with each mapped field set to its value; the template is not modified.
 * Every value must have a binding and every binding a value. Each binding must name a node of its
 * `class_type` and a field that holds a literal (not a link to another node's output), or this
 * throws.
 */
export function buildGraph<Key extends string>(
  template: WorkflowGraph,
  inputsMap: InputsMap<Key>,
  values: Readonly<Record<Key, GraphValue>>,
): WorkflowGraph {
  const graph = structuredClone(template);
  const bindings = new Map<string, InputEntry>(Object.entries(inputsMap.inputs));
  const given = new Map<string, GraphValue>(Object.entries(values));

  for (const key of bindings.keys()) {
    if (!given.has(key)) {
      throw new Error(`Inputs map: ${key} has no value`);
    }
  }

  for (const [key, value] of given) {
    const binding = bindings.get(key);

    if (!binding) {
      throw new Error(`Inputs map: ${key} is not mapped`);
    }

    for (const { class_type, field, node } of [binding].flat()) {
      const target = graph[node];

      if (target?.class_type !== class_type) {
        throw new Error(
          `Inputs map: ${key} expects ${class_type} at node ${node}, found ${target?.class_type ?? "no node"}`,
        );
      }

      if (!(field in target.inputs) || Array.isArray(target.inputs[field])) {
        throw new Error(`Inputs map: ${key} expects a literal field ${node}.${field}`);
      }

      target.inputs[field] = value;
    }
  }

  return graph;
}
