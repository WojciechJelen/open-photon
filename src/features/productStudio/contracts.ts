// Product Studio's public contracts (client-safe, loadable by Node): an uploaded product photo
// (`POST /api/image-uploads`) rendered into one or more product shots at once
// (`POST /api/product-shots`), each a clean packshot, a lifestyle scene or an advertising visual
// generated around the product's own pixels (`product-shot.v1`), grouped as a shoot
// (`GET /api/product-shots/:id`). Client code imports them from `index.ts`.
import { z } from "zod";

import { assetSchema, generationSchema } from "../../shared/contracts.ts";

/** The workflow id of a product shot (`workflows/product-shot.v1.json`). */
export const PRODUCT_SHOT_WORKFLOW = "product-shot";

/** The output a product shot stores its image under. */
export const PRODUCT_SHOT_OUTPUT = "image";

/** The kinds of shot a product can be rendered as, in the order the studio offers them. */
export const productShotPresets = ["packshot", "lifestyle", "advertising"] as const;

export type ProductShotPreset = (typeof productShotPresets)[number];

/** The frames a shot can have, in the order the studio offers them. */
export const productShotFormats = ["square", "portrait", "landscape"] as const;

export type ProductShotFormat = (typeof productShotFormats)[number];

/** What the studio says of each preset, and the scene it renders when no description is given. */
export const presetDetails: Record<
  ProductShotPreset,
  { defaultScene: string; label: string; summary: string }
> = {
  advertising: {
    defaultScene:
      "a round pastel podium in front of a bold gradient backdrop in coral and deep violet",
    label: "Advertising",
    summary: "A bold campaign backdrop",
  },
  lifestyle: {
    defaultScene:
      "a light oak table in a bright, airy interior, soft daylight from a window on the left, a ceramic vase and a linen cloth softly blurred in the background",
    label: "Lifestyle",
    summary: "A real-looking setting",
  },
  packshot: {
    defaultScene: "a seamless pure white studio backdrop",
    label: "Packshot",
    summary: "Clean, on white",
  },
};

/** What the studio says of each format. */
export const formatDetails: Record<ProductShotFormat, { label: string }> = {
  landscape: { label: "Landscape" },
  portrait: { label: "Portrait" },
  square: { label: "Square" },
};

/** What the product is, in a few words (`a green glass bottle of port wine`). */
export const productNameSchema = z.string().trim().min(2).max(120);

/**
 * The scene the user describes instead of a preset's own: trimmed, at most 400 characters; blank
 * is none.
 */
export const sceneDescriptionSchema = z
  .string()
  .trim()
  .max(400)
  .transform((value) => value || undefined)
  .optional();

const seedSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * One product shot (`product-shot.v1`), the generation input the studio's shoot submits per
 * preset: the stored product photo (an image asset's id), what the product is, the preset, an
 * optional scene description replacing the preset's own scene, the format (square by default)
 * and an optional seed (a random one otherwise).
 */
export const productShotInputSchema = z.object({
  description: sceneDescriptionSchema,
  format: z.enum(productShotFormats).default("square"),
  preset: z.enum(productShotPresets),
  product: productNameSchema,
  product_asset_id: z.uuid(),
  seed: seedSchema.optional(),
});

export type ProductShotInput = z.output<typeof productShotInputSchema>;

/**
 * `POST /api/product-shots` JSON body, with a required `request_key` (a UUID): one shot per
 * preset (one to three, each once) of one product, with the same description and format.
 */
export const createShootInputSchema = z.object({
  description: sceneDescriptionSchema,
  format: z.enum(productShotFormats).default("square"),
  presets: z
    .array(z.enum(productShotPresets))
    .min(1)
    .max(productShotPresets.length)
    .refine((presets) => new Set(presets).size === presets.length, {
      message: "Each preset is asked for once.",
    }),
  product: productNameSchema,
  product_asset_id: z.uuid(),
});

export type CreateShootInput = z.input<typeof createShootInputSchema>;

/**
 * One shot of a shoot, in its order (`position`, from 0): its preset, and its current generation
 * (a failed one rendered again through the shared retry is followed to that child; `attempt`
 * counts them).
 */
export const shootItemSchema = z.object({
  attempt: z.int().nonnegative(),
  generation: generationSchema,
  position: z.int().nonnegative(),
  preset: z.enum(productShotPresets),
});

export type ShootItem = z.output<typeof shootItemSchema>;

/** A shoot as `GET /api/product-shots/:id` and `POST /api/product-shots` answer it. */
export const shootSchema = z.object({
  created_at: z.iso.datetime(),
  description: z.string().nullable(),
  format: z.enum(productShotFormats),
  id: z.uuid(),
  items: z.array(shootItemSchema).min(1),
  product: z.object({ image: assetSchema, name: z.string() }),
});

export type Shoot = z.output<typeof shootSchema>;

/** `GET /api/product-shots`: the workspace's latest shoots, most recent first. */
export const shootListSchema = z.object({
  shoots: z.array(
    z.object({
      created_at: z.iso.datetime(),
      id: z.uuid(),
      presets: z.array(z.enum(productShotPresets)),
      product: z.object({ image: assetSchema, name: z.string() }),
      statuses: z.array(generationSchema.shape.status),
    }),
  ),
});

export type ShootList = z.output<typeof shootListSchema>;
