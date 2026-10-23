import { z } from "zod";

import type { AssetReference } from "../comfy-assets.ts";
import type { ProviderTarget } from "../comfy-target.ts";
import type { WorkflowGraph } from "../workflow-graph.ts";
import type { Json } from "./recipe-hash.ts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * What every recipe says about itself, whatever else its workflow puts in it: where it renders
 * (`target`), which workflow file made it (`workflow`: its definition's id and version, the file's
 * SHA-256) and the model files that file loads (`models`, pinned by `models.lock`; empty for
 * recipes made before pins). The service checks it before hashing (`hashRecipe`), so the hash of
 * a recipe identifies its workflow too.
 */
export const recipeIdentitySchema = z.object({
  models: z.array(
    z.object({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  target: z.enum(["cloud", "selfhost"]),
  workflow: z.object({
    id: z.string().min(1),
    sha256: sha256Schema,
    version: z.int().positive(),
  }),
});

/** A recipe as it is stored (`generations.recipe`): a JSON object that carries its identity. */
export type WorkflowRecipe = { [key: string]: Json | undefined } & z.infer<
  typeof recipeIdentitySchema
>;

/**
 * One output a workflow's job produces, collected from the node `nodeId` and stored as the
 * generation's output `name` (`generation_outputs`). An `image` output (PNG, JPEG or WebP, from a
 * `SaveImage` node) is stored as it is downloaded. A `video` output is an MP4 (a `SaveVideo`
 * node); with `poster`, a JPEG still of it at 0.5 s (its first frame when it is shorter) is stored
 * too, as the output `poster`. A `text` output is a text file the node saved (core `SaveText`,
 * format `txt`: Comfy's jobs API lists it as a `.txt` file; it does not list a `PreviewAny`
 * node's text): the first one that is not blank, at most `TEXT_OUTPUT_MAX_BYTES` of valid UTF-8,
 * is stored byte for byte as a private `.txt` asset and shown inline by the generation's API
 * (`generationSchema`); none, or one too long or not UTF-8, fails the generation.
 */
export type OutputDeclaration = {
  name: string;
  nodeId: string;
  media: "image" | "video" | "text";
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
export type PreparedRecipe<Recipe> = { characterId?: string; motionId?: string; recipe: Recipe };

/** What a re-run (`seed` unchanged) or a retry (a new one) of a recipe renders with. */
type RebaseContext = { seed: number; target: ProviderTarget };

/**
 * A workflow the generation service runs (`src/shared/server/generation/`), owned by its feature
 * and registered in `workflows` by the composition (`src/app/server.ts`), where the service finds
 * it again by the `(id, version)` a stored generation records. Everything workflow-specific lives here; the
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
 * - `deriveOutputs` (optional): further outputs the server makes from the stored ones once they
 *   are all stored (`finalize`), by output name (Motion Transfer's side-by-side `compare`); it
 *   stores their assets itself and gets the decoded recipe and the stored asset ids by name. A
 *   declared output keeps its name. A derivation that throws is logged and the row is done
 *   without its outputs: it never fails the generation nor counts as a failed finalize.
 * - `seedOf`, `rebase`: the recipe's seed, and the recipe to render for a re-run or retry on the
 *   server's target now; `null` when this workflow can no longer render it (its file changed).
 * - `workflowHash`, `models`: the workflow file's SHA-256 and its model pins (`models.lock`).
 * - `promptOf` (optional): the text prompt a recipe renders, which what is saved from its output
 *   keeps as its provenance (`readGenerationProvenance`: a generated character's `prompt`). A
 *   workflow without a text prompt leaves it out.
 * - `shareRecipe` (optional): what the public share page (`/r/:slug`, `readGenerationShare`) may
 *   show of a recipe; without it, the recipe. A workflow whose recipe holds private text (an
 *   enhanced caption, which is a private text output) leaves that out here.
 */
export type WorkflowDefinition<Input, Recipe extends WorkflowRecipe> = {
  id: string;
  version: number;
  workflowHash: string;
  models: readonly { file: string; license: string; sha256: string }[];
  inputSchema: z.ZodType<Input>;
  recipeSchema: z.ZodType<Recipe>;
  outputs: readonly OutputDeclaration[];
  deriveOutputs?(
    recipe: Recipe,
    outputs: Readonly<Record<string, string>>,
  ): Promise<Readonly<Record<string, string>>>;
  prepareRecipe(input: Input, context: PrepareContext): PreparedRecipe<Recipe>;
  assetInputs(recipe: Recipe): Readonly<Record<string, string>>;
  buildGraph(
    recipe: Recipe,
    providerInputs: Readonly<Record<string, AssetReference>>,
  ): WorkflowGraph;
  seedOf(recipe: Recipe): number;
  rebase(recipe: Recipe, context: RebaseContext): Recipe | null;
  promptOf?(recipe: Recipe): string;
  shareRecipe?(recipe: Recipe): Json;
};

/** A definition as the registry holds it, whichever input and recipe it types. */
export type AnyWorkflowDefinition = WorkflowDefinition<Json, WorkflowRecipe>;

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

const byKey = new Map<string, AnyWorkflowDefinition>();

// The keys `compose` set last.
let composed: string[] = [];

/** Adds one definition; a second one with its id and version, or unstorable outputs, throw. */
function register(definition: AnyWorkflowDefinition) {
  const key = `${definition.id}@${definition.version}`;
  const problem = outputsProblem(definition.outputs);

  if (byKey.has(key)) {
    throw new Error(`Two workflow definitions are ${definition.id} v${definition.version}`);
  }

  if (problem) {
    throw new Error(`Workflow ${definition.id} v${definition.version} ${problem}`);
  }

  byKey.set(key, definition);

  return key;
}

/**
 * The workflows this server runs, found by the `(workflow_id, workflow_version)` a generation row
 * records (`service.ts`, `finalize.ts`, `readGenerationProvenance`). The composition,
 * `src/app/server.ts`, sets every feature's definition (`compose`) as it loads, which every server
 * entry (the boot plugin, the access guard) and test database does before a generation runs; a
 * test adds its own workflow (`register`). It lives here, not in the composition, so that a
 * feature API which reads through the service (a generated character's provenance) can be
 * imported by a composed workflow without an import cycle.
 */
export const workflows = {
  /**
   * Sets the composition's definitions, in place of those it set before (a dev server reloads
   * it); definitions added with `register` stay.
   */
  compose: (definitions: readonly AnyWorkflowDefinition[]) => {
    for (const key of composed) {
      byKey.delete(key);
    }

    composed = definitions.map(register);
  },
  /** The definition of a stored generation; `undefined` when no feature registers it. */
  find: (row: { workflow_id: string; workflow_version: number }) =>
    byKey.get(`${row.workflow_id}@${row.workflow_version}`),
  register,
};
