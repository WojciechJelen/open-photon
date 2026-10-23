import type { z } from "zod";

import type { AssetReference } from "../comfy-assets.ts";
import type { ProviderTarget } from "../comfy-target.ts";
import type { WorkflowGraph } from "../workflow-graph.ts";
import type { Json } from "./recipe-hash.ts";

/** What a recipe is stored as: a JSON object (`generations.recipe`). */
export type RecipeJson = { [key: string]: Json | undefined };

/**
 * One file a workflow's job produces, collected from the `SaveImage`/`SaveVideo` node `nodeId`
 * and stored as the generation's output `name` (`generation_outputs`). An `image` output (PNG,
 * JPEG or WebP) is stored as it is downloaded. A `video` output is an MP4; with `poster`, a JPEG
 * still of it at 0.5 s (its first frame when it is shorter) is stored too, as the output `poster`.
 */
export type OutputDeclaration = {
  name: string;
  nodeId: string;
  media: "image" | "video";
  poster?: boolean;
};

/** The name of the still cut from the `video` output that declares `poster`. */
export const POSTER_OUTPUT = "poster";

/** What `prepareRecipe` knows besides the input: the endpoint the generation will run on. */
type PrepareContext = { target: ProviderTarget };

/**
 * The resolved recipe of a request, with the rows it links to: the character it renders
 * (`generations.character_id`) and the sample motion it was made from (`motion_id`), if any.
 */
type PreparedRecipe<Recipe> = { characterId?: string; motionId?: string; recipe: Recipe };

/** What a re-run (`seed` unchanged) or a retry (a new one) of a recipe renders with. */
type RebaseContext = { seed: number; target: ProviderTarget };

/**
 * A workflow the generation service runs (`src/shared/server/generation/`), owned by its feature
 * and composed in `src/app/server.ts` (`createWorkflowRegistry`), which finds it again by the
 * `(id, version)` a stored generation records. Everything workflow-specific lives here; the
 * service treats a recipe as an opaque, validated value.
 *
 * - `inputSchema`: the request body a feature's route accepts (`parseInput`).
 * - `prepareRecipe`: the immutable recipe for an input, with presets, defaults and the seed
 *   resolved once; it throws `GenerateError` for an input it refuses (a missing file, a clip too
 *   long). The same choices must give the same recipe: its hash is how results are reused.
 * - `recipeSchema`: a strict schema that decodes every recipe this version ever stored.
 * - `assetInputs`: the stored files (by SHA-256) the recipe uploads to the provider, by the
 *   name `buildGraph` receives their references under; none for a scalar-only workflow, which is
 *   then submitted without an upload and with no `provider_inputs`.
 * - `buildGraph`: the API graph to submit for the recipe and those references.
 * - `outputs`: the files the job produces (`OutputDeclaration`).
 * - `seedOf`, `rebase`: the recipe's seed, and the recipe to render for a re-run or retry on the
 *   server's target now; `null` when this workflow can no longer render it (its file changed).
 * - `workflowHash`, `models`: the workflow file's SHA-256 and its model pins (`models.lock`).
 */
export type WorkflowDefinition<Input, Recipe extends RecipeJson> = {
  id: string;
  version: number;
  workflowHash: string;
  models: readonly { file: string; license: string; sha256: string }[];
  inputSchema: z.ZodType<Input>;
  recipeSchema: z.ZodType<Recipe>;
  outputs: readonly OutputDeclaration[];
  prepareRecipe(input: Input, context: PrepareContext): PreparedRecipe<Recipe>;
  assetInputs(recipe: Recipe): Readonly<Record<string, string>>;
  buildGraph(
    recipe: Recipe,
    providerInputs: Readonly<Record<string, AssetReference>>,
  ): WorkflowGraph;
  seedOf(recipe: Recipe): number;
  rebase(recipe: Recipe, context: RebaseContext): Recipe | null;
};

/** A definition as the registry holds it, whichever input and recipe it types. */
type AnyWorkflowDefinition = WorkflowDefinition<Json, RecipeJson>;

/** Why a definition's output declarations cannot be stored, or `null` when they can. */
function outputsProblem(outputs: readonly OutputDeclaration[]) {
  const names = outputs.map(({ name }) => name);
  const posters = outputs.filter(({ poster }) => poster);

  if (outputs.length === 0) {
    return "declares no output";
  }

  if (new Set(names).size !== names.length) {
    return "declares two outputs with one name";
  }

  if (posters.length > 1 || posters.some(({ media }) => media !== "video")) {
    return "may cut one poster, from a video output";
  }

  if (posters.length === 1 && names.includes(POSTER_OUTPUT)) {
    return `names an output "${POSTER_OUTPUT}", the name of its poster`;
  }

  return null;
}

/**
 * The workflows a server runs, found by the `(workflow_id, workflow_version)` a generation row
 * records. `register` adds one more (a test's own workflow, say); a second definition with one id
 * and version, or outputs that cannot be stored, throw.
 */
export function createWorkflowRegistry(definitions: readonly AnyWorkflowDefinition[]) {
  const byKey = new Map<string, AnyWorkflowDefinition>();

  const register = (definition: AnyWorkflowDefinition) => {
    const key = `${definition.id}@${definition.version}`;
    const problem = outputsProblem(definition.outputs);

    if (byKey.has(key)) {
      throw new Error(`Two workflow definitions are ${definition.id} v${definition.version}`);
    }

    if (problem) {
      throw new Error(`Workflow ${definition.id} v${definition.version} ${problem}`);
    }

    byKey.set(key, definition);
  };

  for (const definition of definitions) {
    register(definition);
  }

  return {
    /** The definition of a stored generation; `undefined` when no feature registers it. */
    find: (row: { workflow_id: string; workflow_version: number }) =>
      byKey.get(`${row.workflow_id}@${row.workflow_version}`),
    register,
  };
}
