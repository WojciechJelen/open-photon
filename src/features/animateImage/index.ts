// Animate Image's public client module (`scripts/check-import-boundaries.mjs`): how another
// feature hands a still over to `/animate` (a done generation's image output, or a library
// character), and the request contract of `POST /api/animations`.
export {
  ANIMATE_IMAGE_WORKFLOW,
  type AnimateImageInput,
  animateImageHref,
  animateImageInputSchema,
  VIDEO_OUTPUT,
} from "./contracts.ts";
