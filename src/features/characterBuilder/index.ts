// The character builder's public client module: its contracts, which other features' client code
// (and tests) may import (`scripts/check-import-boundaries.mjs`). Test fixtures of its requests
// and generations are in `tests/fixtures.ts`.
export {
  CAPTION_OUTPUT,
  CHARACTER_CAPTION_WORKFLOW,
  CHARACTER_FRAMING,
  CHARACTER_GENERATION_WORKFLOW,
  type CharacterCaptionInput,
  characterCaptionInputSchema,
  type CharacterControls,
  characterControlsSchema,
  type CharacterGenerationInput,
  characterGenerationInputSchema,
  type CharacterStyle,
  characterStyles,
  compileCharacterRequest,
  IMAGE_OUTPUT,
  imageSideSchema,
  type SaveCharacterInput,
  saveCharacterInputSchema,
} from "./contracts.ts";
