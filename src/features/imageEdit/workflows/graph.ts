import { z } from "zod";

import {
  buildGraph,
  type GraphValue,
  type InputsMap,
  type WorkflowGraph,
} from "../../../shared/server/workflow-graph.ts";
import { REFERENCE_PARAMS } from "./registry.ts";

/** An edit workflow as `loadRuntimeWorkflow` reads it: the graph and its inputs map. */
type EditWorkflow = { graph: WorkflowGraph; inputsMap: InputsMap };

/** A node input that links another node's output: `[node id, output slot]`. */
const linkSchema = z.tuple([z.string(), z.int()]);

/** What an edit graph is built from: the scalars and one `LoadImage` value per reference (1–3). */
type EditValues = {
  height: number;
  prompt: string;
  references: readonly GraphValue[];
  seed: number;
  width: number;
};

/**
 * The graph of `workflow` for `values`: the workflow files hold three reference slots
 * (`LoadImage` `11`, `12`, `13`, read by `ReferenceMultiLatent` `17` and, enhanced, by
 * `BatchImagesNode` `50` as `images.image0..2`); an edit with fewer references leaves out the
 * unused `LoadImage` nodes and every input linked to them, then binds the rest with the shared
 * `buildGraph`, which checks each binding's node class and literal field.
 */
export function editGraph(workflow: EditWorkflow, { references, ...scalars }: EditValues) {
  if (references.length < 1 || references.length > REFERENCE_PARAMS.length) {
    throw new Error(
      `An edit takes 1–${REFERENCE_PARAMS.length} references, not ${references.length}`,
    );
  }

  const unused: readonly string[] = REFERENCE_PARAMS.slice(references.length);

  const dropped = new Set(
    unused.flatMap((param) =>
      [workflow.inputsMap.inputs[param] ?? []].flat().map(({ node }) => node),
    ),
  );

  const template = Object.fromEntries(
    Object.entries(workflow.graph)
      .filter(([id]) => !dropped.has(id))
      .map(([id, node]) => [
        id,
        {
          ...node,
          inputs: Object.fromEntries(
            Object.entries(node.inputs).filter(([, value]) => {
              const link = linkSchema.safeParse(value);

              return !(link.success && dropped.has(link.data[0]));
            }),
          ),
        },
      ]),
  );

  const inputs = Object.fromEntries(
    Object.entries(workflow.inputsMap.inputs).filter(([param]) => !unused.includes(param)),
  );

  return buildGraph(
    template,
    { inputs, workflow: workflow.inputsMap.workflow },
    {
      ...scalars,
      ...Object.fromEntries(
        references.map((reference, index) => [REFERENCE_PARAMS[index], reference]),
      ),
    },
  );
}
