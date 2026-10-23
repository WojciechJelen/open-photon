// A scalar-only text-to-image workflow, as the character generation's will be: a prompt and a
// seed in, one `SaveImage` output named `image`, nothing uploaded. It exists for tests only and
// registers itself beside the app's own workflows (`workflows`) when this module loads.
import { z } from "zod";

import { providerTarget } from "../src/shared/server/comfy-target.ts";
import {
  recipeIdentitySchema,
  type WorkflowDefinition,
  workflows,
} from "../src/shared/server/generation/definition.ts";
import {
  buildGraph,
  inputsMapSchema,
  workflowGraphSchema,
} from "../src/shared/server/workflow-graph.ts";

/** A text-to-image graph in API format: scalar inputs only, one `SaveImage` output. */
const template = workflowGraphSchema.parse({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "test.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "" } },
  "3": { class_type: "EmptyLatentImage", inputs: { batch_size: 1, height: 512, width: 512 } },
  "4": {
    class_type: "KSampler",
    inputs: { latent_image: ["3", 0], model: ["1", 0], positive: ["2", 0], seed: 0 },
  },
  "5": { class_type: "VAEDecode", inputs: { samples: ["4", 0], vae: ["1", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "test", images: ["5", 0] } },
});

const inputsMap = inputsMapSchema(["prompt", "seed", "width", "height"]).parse({
  inputs: {
    height: { class_type: "EmptyLatentImage", field: "height", node: "3" },
    prompt: { class_type: "CLIPTextEncode", field: "text", node: "2" },
    seed: { class_type: "KSampler", field: "seed", node: "4" },
    width: { class_type: "EmptyLatentImage", field: "width", node: "3" },
  },
  workflow: "test-image.v1.json",
});

const recipeSchema = recipeIdentitySchema
  .extend({
    height: z.int().positive(),
    prompt: z.string().min(1),
    seed: z.int().nonnegative(),
    width: z.int().positive(),
  })
  .strict();

type ImageRecipe = z.output<typeof recipeSchema>;

const workflow = { id: "test-image", sha256: "0".repeat(64), version: 1 };

/** The test workflow's recipe for `prompt` and `seed` on `target`. */
export function imageRecipe(prompt: string, seed: number, target = providerTarget()): ImageRecipe {
  return { height: 832, models: [], prompt, seed, target: target.kind, width: 512, workflow };
}

/** The test workflow (`test-image` v1), registered in the app's `workflows`. */
export const imageDefinition: WorkflowDefinition<{ prompt: string; seed?: number }, ImageRecipe> = {
  assetInputs: () => ({}),
  buildGraph: ({ height, prompt, seed, width }) =>
    buildGraph(template, inputsMap, { height, prompt, seed, width }),
  id: workflow.id,
  inputSchema: z.object({ prompt: z.string().min(1), seed: z.int().optional() }),
  models: [],
  outputs: [{ media: "image", name: "image", nodeId: "9" }],
  prepareRecipe: ({ prompt, seed }, { target }) => ({
    recipe: imageRecipe(prompt, seed ?? 7, target),
  }),
  promptOf: (recipe) => recipe.prompt,
  rebase: (recipe, { seed, target }) => ({ ...recipe, seed, target: target.kind }),
  recipeSchema,
  seedOf: (recipe) => recipe.seed,
  version: workflow.version,
  workflowHash: workflow.sha256,
};

workflows.register(imageDefinition);
