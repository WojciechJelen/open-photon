import { presetDetails, type ProductShotFormat, type ProductShotPreset } from "../contracts.ts";

/**
 * The prompt of a shot: the preset's sentence around what the product is and the scene (the
 * user's description, else the preset's own), measured on Comfy Cloud (`workflows/README.md`).
 * Pure: the same choices always make the same prompt, which the recipe stores.
 */
export function shotPrompt(preset: ProductShotPreset, product: string, description?: string) {
  const scene = description ?? presetDetails[preset].defaultScene;

  switch (preset) {
    case "packshot":
      return `Professional e-commerce packshot of ${product}, placed in the center. Background: ${scene}. Soft even studio lighting, a soft natural contact shadow directly under the product, clean and minimal, photorealistic, high detail.`;
    case "lifestyle":
      return `Lifestyle product photograph of ${product}, placed in a real setting. Setting: ${scene}. Natural light, a natural soft shadow under the product, shallow depth of field, photorealistic.`;
    case "advertising":
      return `Advertising key visual of ${product}, placed as the hero of the image. Backdrop: ${scene}. Dramatic studio lighting with a rim light, a soft reflection and shadow under the product, premium commercial photography, photorealistic.`;
  }
}

/**
 * Where a format puts the product: the canvas (multiples of 16, about one megapixel, FLUX's
 * latent) and the box the product photo is fitted into (aspect kept, centred in the box), with a
 * margin below it for the floor and its shadow.
 */
export const layouts: Record<
  ProductShotFormat,
  {
    box_height: number;
    box_width: number;
    box_x: number;
    box_y: number;
    height: number;
    width: number;
  }
> = {
  landscape: { box_height: 576, box_width: 576, box_x: 320, box_y: 160, height: 832, width: 1216 },
  portrait: { box_height: 864, box_width: 576, box_x: 160, box_y: 176, height: 1152, width: 896 },
  square: { box_height: 736, box_width: 608, box_x: 208, box_y: 160, height: 1024, width: 1024 },
};
