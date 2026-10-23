import { type GenerationSnapshot, generationSchema } from "../../../shared/contracts.ts";
// Frozen data for developing the character builder against its contracts before the FLUX 3
// workflows land: a caption request, a done caption enhancement and a done character image as
// `GET /api/generations/:id` returns them, a generation request made from that caption, and the
// character saved from the image. Each is parsed by its schema, so a contract change breaks it
// here first. Loadable by Node and by Playwright; ids are fixed, not those of any database.
import { type CharacterSummary, characterSummarySchema } from "../../characters/index.ts";
import {
  CAPTION_OUTPUT,
  CHARACTER_GENERATION_WORKFLOW,
  type CharacterCaptionInput,
  characterCaptionInputSchema,
  type CharacterGenerationInput,
  characterGenerationInputSchema,
  IMAGE_OUTPUT,
} from "../contracts.ts";

/** The id of `captionGenerationFixture`. */
export const captionGenerationId = "0f6b5a8e-3c2d-4e1f-9a7b-6c5d4e3f2a10";

/** The id of `imageGenerationFixture`. */
export const imageGenerationId = "7a1c2e3d-4b5f-4a6e-8d7c-9b0a1f2e3d40";

/** A description with every control, as the builder's form sends it to be enhanced. */
export const captionInputFixture: CharacterCaptionInput = Object.freeze(
  characterCaptionInputSchema.parse({
    controls: {
      appearance: "Short curly red hair, freckles, mid-thirties",
      outfit: "A mustard raincoat over a striped shirt, jeans and yellow boots",
      style: "realistic",
    },
    description: "A cheerful street musician who plays the accordion",
    seed: 42,
  }),
);

/** The enhanced caption `captionGenerationFixture` shows. */
export const enhancedCaptionFixture =
  "A full-body photograph of a cheerful street musician in her mid-thirties with short curly red hair and freckles, wearing a mustard raincoat over a striped shirt, blue jeans and yellow rubber boots, an accordion strapped to her chest, standing upright in a relaxed neutral pose facing the camera with both hands and both feet fully visible, on a plain light-grey background under soft, even studio lighting.";

/** A done caption enhancement, as `GET /api/generations/:id` returns it: one text output. */
export const captionGenerationFixture: GenerationSnapshot = Object.freeze(
  generationSchema.parse({
    character_id: null,
    created_at: "2026-10-23T10:00:00.000Z",
    error_code: null,
    error_message: null,
    final_asset_id: null,
    finished_at: "2026-10-23T10:00:09.000Z",
    id: captionGenerationId,
    outputs: [{ media: "text", name: CAPTION_OUTPUT, text: enhancedCaptionFixture }],
    parent_id: null,
    poster_asset_id: null,
    progress: 100,
    share_slug: null,
    status: "done",
    submitted_at: "2026-10-23T10:00:01.000Z",
  }),
);

/** The caption, edited by hand after the enhancement, rendered with the enhancement's provenance. */
export const generationInputFixture: CharacterGenerationInput = Object.freeze(
  characterGenerationInputSchema.parse({
    caption: `${enhancedCaptionFixture} She smiles.`,
    seed: 42,
    source: { caption_generation_id: captionGenerationId },
  }),
);

/** A done character image, as `GET /api/generations/:id` returns it: one PNG output `image`. */
export const imageGenerationFixture: GenerationSnapshot = Object.freeze(
  generationSchema.parse({
    character_id: null,
    created_at: "2026-10-23T10:01:00.000Z",
    error_code: null,
    error_message: null,
    final_asset_id: null,
    finished_at: "2026-10-23T10:01:20.000Z",
    id: imageGenerationId,
    outputs: [
      {
        asset: {
          bytes: 1_009_733,
          created_at: "2026-10-23T10:01:20.000Z",
          duration_ms: null,
          fps: null,
          has_audio: null,
          height: 1344,
          id: "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e60",
          kind: "image",
          mime: "image/png",
          role: "provider_output",
          sha256: "b".repeat(64),
          source_asset_id: null,
          width: 768,
        },
        media: "image",
        name: IMAGE_OUTPUT,
      },
    ],
    parent_id: null,
    poster_asset_id: null,
    progress: 100,
    share_slug: "1a2b3c4d5e6f7a8b",
    status: "done",
    submitted_at: "2026-10-23T10:01:02.000Z",
  }),
);

const [imageOutput] = imageGenerationFixture.outputs;

/** The character saved from `imageGenerationFixture` (`POST …/:generationId/character`, 201). */
export const savedCharacterFixture: CharacterSummary = Object.freeze(
  characterSummarySchema.parse({
    consent_at: null,
    created_at: "2026-10-23T10:02:00.000Z",
    favorite_at: null,
    generation_id: imageGenerationId,
    id: "e5f6a7b8-c9d0-4e1f-a2b3-c4d5e6f7a890",
    image: imageOutput?.media === "image" ? imageOutput.asset : null,
    image_asset_id: imageOutput?.media === "image" ? imageOutput.asset.id : null,
    is_sample: false,
    origin: "generated",
    prompt: generationInputFixture.caption,
    provenance: {
      models: [
        {
          file: "flux3-image-klein-int8-convrot.safetensors",
          license: "FLUX-Kommunity-1.0",
          sha256: "c".repeat(64),
        },
      ],
      workflow: { id: CHARACTER_GENERATION_WORKFLOW, sha256: "d".repeat(64), version: 1 },
    },
    slug: null,
    title: "Street musician",
    updated_at: null,
  }),
);
