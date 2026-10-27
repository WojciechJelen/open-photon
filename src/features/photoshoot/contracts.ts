// The photoshoot feature's contracts: a photoshoot is one library character photographed in one
// setting, four shots, each its own generation of the shared image-edit workflow (admitted at
// once through `submitMany`) and shown side by side at `/photoshoot/:id`. Client-safe, and
// loadable by Node as is (relative `.ts` imports).
import { z } from "zod";

import { generationSchema, generationStatusSchema } from "../../shared/contracts.ts";
import { characterSummarySchema, characterTitleSchema } from "../characters/index.ts";
import { photoshootSettingIds } from "./settings.ts";

export const photoshootSettingSchema = z.enum(photoshootSettingIds);

/**
 * `POST /api/photoshoots` JSON body, with a required `request_key` (a UUID): the same key again
 * returns the photoshoot the first request admitted, whatever its body. The character is any the
 * session may see (a sample, an upload made with consent, a saved generated character).
 */
export const createPhotoshootInputSchema = z.object({
  character_id: z.uuid(),
  setting: photoshootSettingSchema,
});

export type CreatePhotoshootInput = z.output<typeof createPhotoshootInputSchema>;

/** The photographed character as the photoshoot page shows it. */
const photoshootCharacterSchema = characterSummarySchema.pick({
  id: true,
  image: true,
  is_sample: true,
  origin: true,
  title: true,
});

/**
 * One shot of a photoshoot, in its order (`position`, also the shot of the setting):
 * `generation` is its current generation (a failed or cancelled one rendered again through the
 * shared retry is followed to that child; `attempt` counts them), `reused` that its first
 * generation was an existing one with the same recipe.
 */
export const photoshootItemSchema = z.object({
  attempt: z.int().nonnegative(),
  generation: generationSchema,
  position: z.int().nonnegative(),
  reused: z.boolean(),
});

export type PhotoshootItem = z.output<typeof photoshootItemSchema>;

/**
 * A photoshoot: `GET /api/photoshoots/:id`, and the answer to `POST /api/photoshoots` (201
 * admitted now, 200 the one its request key admitted before). `character` is `null` when it is
 * no longer readable.
 */
export const photoshootSchema = z.object({
  character: photoshootCharacterSchema.nullable(),
  created_at: z.iso.datetime(),
  id: z.uuid(),
  items: z.array(photoshootItemSchema).min(1),
  setting: photoshootSettingSchema,
});

export type Photoshoot = z.output<typeof photoshootSchema>;

/** `GET /api/photoshoots`: the workspace's latest photoshoots, each item's current status. */
export const photoshootListSchema = z.object({
  photoshoots: z.array(
    z.object({
      character: photoshootCharacterSchema.nullable(),
      created_at: z.iso.datetime(),
      id: z.uuid(),
      setting: photoshootSettingSchema,
      statuses: z.array(generationStatusSchema).min(1),
    }),
  ),
});

export type PhotoshootList = z.output<typeof photoshootListSchema>;

/**
 * `POST /api/photoshoots/:id/character` JSON body: saves the image of one of the photoshoot's
 * done generations (`generation_id`, a current one of its items) to the library, with an optional
 * title. The user's explicit action; nothing is saved on completion.
 */
export const savePhotoshootResultSchema = z.strictObject({
  generation_id: z.uuid(),
  title: characterTitleSchema.optional(),
});
