// Shots & Angles' contracts: an angle set is one character seen from several camera angles, one
// generation per view (`angle-view`, Qwen-Image-Edit-2511 with the Multiple-Angles LoRA), admitted
// together through the generation service (`submitMany`) and shown side by side at
// `/angles/:id`. Client-safe, and loadable by Node as is (relative `.ts` imports).
import { z } from "zod";

import { generationSchema, generationStatusSchema } from "../../shared/contracts.ts";
import { characterSummarySchema, characterTitleSchema } from "../characters/index.ts";

/** The workflow id of one view, as its generation rows record it. */
export const ANGLE_VIEW_WORKFLOW = "angle-view";

/** The image output of a view's generation. */
export const VIEW_OUTPUT = "image";

/**
 * The camera angles a set can ask for, in the order a set shows them: the character seen from
 * the front, turned about 45° (three-quarter), seen from the side (profile), and a head-and-
 * shoulders close-up re-rendered at that distance (not a crop).
 */
export const angleViews = ["front", "three-quarter", "profile", "close-up"] as const;

export const angleViewSchema = z.enum(angleViews);

export type AngleView = z.output<typeof angleViewSchema>;

/** What each view is called on the page. */
export const viewLabels: Record<AngleView, string> = {
  "close-up": "Close-up",
  front: "Front",
  profile: "Profile",
  "three-quarter": "Three-quarter",
};

// A seed as the generation service stores it.
const seedSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * One view's generation input (the `angle-view` workflow's `inputSchema`): the library character
 * whose image is the reference, the view, and the seed (a set gives every view the same one).
 */
export const angleViewInputSchema = z.strictObject({
  character_id: z.uuid(),
  seed: seedSchema.optional(),
  view: angleViewSchema,
});

export type AngleViewInput = z.output<typeof angleViewInputSchema>;

/**
 * `POST /api/angle-sets` JSON body, with a required `request_key` (a UUID): the character, one to
 * four distinct views, and optionally the seed every view renders with (else one is drawn). The
 * same key again returns the set it admitted, whatever the body.
 */
export const createAngleSetInputSchema = z.object({
  character_id: z.uuid(),
  seed: seedSchema.optional(),
  views: z
    .array(angleViewSchema)
    .min(1)
    .max(angleViews.length)
    .refine((views) => new Set(views).size === views.length, {
      message: "Every view of a set is different.",
    }),
});

export type CreateAngleSetInput = z.output<typeof createAngleSetInputSchema>;

/** The set's character as its page shows it; `null` once it is no longer in the library. */
const angleCharacterSchema = characterSummarySchema.pick({
  id: true,
  image: true,
  is_sample: true,
  origin: true,
  title: true,
});

/**
 * One view of a set, in its order (`position`, from 0): the view, whether its first generation
 * was an existing one with the same recipe (`reused`, free), its current generation (a failed or
 * cancelled one rendered again by the shared retry is followed to that child; `attempt` counts
 * them), and the library character saved from it, if any.
 */
export const angleSetItemSchema = z.object({
  attempt: z.int().nonnegative(),
  generation: generationSchema,
  position: z.int().nonnegative(),
  reused: z.boolean(),
  saved_character_id: z.uuid().nullable(),
  view: angleViewSchema,
});

export type AngleSetItem = z.output<typeof angleSetItemSchema>;

/**
 * An angle set: `GET /api/angle-sets/:id`, and the answer to `POST /api/angle-sets` (201 admitted
 * now, 200 the set its request key admitted before).
 */
export const angleSetSchema = z.object({
  character: angleCharacterSchema.nullable(),
  created_at: z.iso.datetime(),
  id: z.uuid(),
  items: z.array(angleSetItemSchema).min(1),
  seed: seedSchema,
});

export type AngleSet = z.output<typeof angleSetSchema>;

/** `GET /api/angle-sets`: the workspace's latest sets, each with its views' current statuses. */
export const angleSetListSchema = z.object({
  sets: z.array(
    z.object({
      character: angleCharacterSchema.nullable(),
      created_at: z.iso.datetime(),
      id: z.uuid(),
      views: z.array(z.object({ status: generationStatusSchema, view: angleViewSchema })).min(1),
    }),
  ),
});

export type AngleSetList = z.output<typeof angleSetListSchema>;

/**
 * `POST /api/angle-sets/:id/items/:position/character` JSON body (`{}` for no title): saves that
 * view's current image to the library as a character.
 */
export const saveViewInputSchema = z.strictObject({ title: characterTitleSchema.optional() });
