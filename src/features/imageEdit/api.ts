/**
 * The image-edit feature's public server API: one reference-image edit workflow (FLUX 3 Image
 * Klein distilled, `workflows/README.md`) that other features submit through the shared generation
 * service with their own prompt and references. It owns no route, table or UI: a consumer keeps
 * its own and passes `imageEditDefinitionFor(input)` to `submit` or `submitMany`. Server-only;
 * client code imports `index.ts`.
 */
import type { ImageEditInput } from "./contracts.ts";
import { imageEditDefinition, imageEditEnhancedDefinition } from "./workflows/definition.ts";

export {
  IMAGE_EDIT_CAPTION_OUTPUT,
  IMAGE_EDIT_OUTPUT,
  type ImageEditInput,
  imageEditInputSchema,
} from "./contracts.ts";

export { imageEditDefinition, imageEditEnhancedDefinition } from "./workflows/definition.ts";

/**
 * The definition that renders `input`: `imageEditEnhancedDefinition` for `enhance: true`, else
 * `imageEditDefinition`. A definition refuses an input of the other (422 `invalid_input`), so the
 * items of one `submitMany` share their `enhance`.
 */
export function imageEditDefinitionFor(input: Pick<ImageEditInput, "enhance">) {
  return input.enhance ? imageEditEnhancedDefinition : imageEditDefinition;
}
