// The image-edit feature's public client module: the contracts other features' client code may
// import (`scripts/check-import-boundaries.mjs`) to build an edit's input and read its outputs.
// Contracts only, so Node loads it as is; server code imports `api.ts`.
export {
  IMAGE_EDIT_CAPTION_OUTPUT,
  IMAGE_EDIT_MAX_REFERENCES,
  IMAGE_EDIT_OUTPUT,
  IMAGE_EDIT_PIXELS,
  IMAGE_EDIT_SIDE,
  type ImageEditInput,
  imageEditInputSchema,
  type ImageEditReference,
} from "./contracts.ts";
