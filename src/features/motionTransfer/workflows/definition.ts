import { findAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import type { WorkflowDefinition } from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { buildGraph } from "../../../shared/server/workflow-graph.ts";
import { getCharacter } from "../../characters/api.ts";
import { type GenerateInput, generateInputSchema, MAX_CLIP_MS } from "../contracts.ts";
import { stitchCompare } from "../server/media/compare.ts";
import { anglePresets, generateDefaults } from "../server/presets.ts";
import { type Recipe, recipeSchema } from "../server/recipe.ts";
import { motionTransferParamsSchema } from "./params.ts";
import { motionTransferModels, motionTransferWorkflow } from "./registry.ts";

/** The id of the sample motion whose clip `assetId` is, if it is one. */
function sampleMotionId(assetId: string) {
  const row = database.prepare("SELECT id FROM motions WHERE source_asset_id = ?").get(assetId);

  return row ? String(row.id) : undefined;
}

/**
 * Motion Transfer's workflow, `motion-transfer.v1` (Wan Animate 2), for the generation service
 * (`src/shared/server/generation/`): a stored 3–8 s motion clip performed by a character, at 480
 * wide (848 for a landscape clip), into one MP4 with the driving clip's audio and a poster, and,
 * once those are stored, a vertical side-by-side of the clip and the result (`compare`,
 * `stitchCompare`; a take whose stitch fails is done without it).
 *
 * The input is `generateInputSchema`. The motion must be a stored, probed video of at most 8 s;
 * the character a generated one or an upload with consent; an angle one of `angles.json`, whose
 * phrasing is appended to the prompt (it is a prompt fragment, not a node field:
 * `workflows/README.md`). A blank prompt and seed are the fixed defaults of `defaults.json`, so
 * the same choices are the same recipe and reuse its result.
 */
export const motionTransferDefinition: WorkflowDefinition<GenerateInput, Recipe> = {
  assetInputs: ({ inputs }) => ({
    driving_video: inputs.driving_video_sha256,
    reference_image: inputs.reference_image_sha256,
  }),
  buildGraph: (recipe, providerInputs) =>
    buildGraph(
      motionTransferWorkflow.graph,
      motionTransferWorkflow.inputsMap,
      motionTransferParamsSchema.parse({ ...recipe.params, ...providerInputs }),
    ),
  deriveOutputs: stitchCompare,
  id: "motion-transfer",
  inputSchema: generateInputSchema,
  models: motionTransferModels,
  outputs: [{ media: "video", name: "video", nodeId: "246", poster: true }],
  prepareRecipe: (input, { target }) => {
    const motion = findAsset(input.motion_asset_id);

    if (motion?.kind !== "video") {
      throw new GenerateError(404, "Motion clip not found.");
    }

    if (motion.duration_ms === null || motion.width === null || motion.height === null) {
      throw new GenerateError(422, "This clip has not been probed. Upload it again.");
    }

    if (motion.duration_ms > MAX_CLIP_MS) {
      throw new GenerateError(422, "This clip is longer than 8 seconds. Trim it first.");
    }

    // `null` too for one whose image is not stored.
    const character = getCharacter(input.character_id);

    if (!character) {
      throw new GenerateError(404, "Character not found.");
    }

    if (character.origin === "upload" && character.consent_at === null) {
      throw new GenerateError(422, "This character was uploaded without likeness consent.");
    }

    const angle =
      input.angle === undefined
        ? undefined
        : anglePresets.angles.find((preset) => preset.id === input.angle);

    if (input.angle !== undefined && !angle) {
      throw new GenerateError(422, `There is no reshoot angle “${input.angle}”.`);
    }

    const portrait = motion.height >= motion.width;
    const prompt = input.prompt ?? generateDefaults.prompt;

    return {
      characterId: character.id,
      motionId: sampleMotionId(motion.id),
      recipe: {
        angle: angle?.id,
        inputs: {
          driving_video_sha256: motion.sha256,
          reference_image_sha256: character.image.sha256,
        },
        models: motionTransferModels,
        params: {
          fragment_length: 81,
          height: portrait ? 848 : 480,
          prompt: angle ? `${prompt.trimEnd()} ${angle.fragment}` : prompt,
          // A fixed default, so the same choices are the same recipe (and reuse its result).
          seed: input.seed ?? generateDefaults.seed,
          width: portrait ? 480 : 848,
        },
        target: target.kind,
        workflow: { id: "motion-transfer", sha256: motionTransferWorkflow.sha256, version: 1 },
      },
    };
  },
  // A recipe made with another workflow file cannot be rendered again by this one.
  rebase: (recipe, { seed, target }) =>
    recipe.workflow.id === "motion-transfer" &&
    recipe.workflow.version === 1 &&
    recipe.workflow.sha256 === motionTransferWorkflow.sha256
      ? { ...recipe, params: { ...recipe.params, seed }, target: target.kind }
      : null,
  recipeSchema,
  seedOf: (recipe) => recipe.params.seed,
  version: 1,
  workflowHash: motionTransferWorkflow.sha256,
};
