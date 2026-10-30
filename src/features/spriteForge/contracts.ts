// Sprite Forge's contracts. A sprite set is one library character drawn from five directions
// (`sprite-view`: Qwen-Image-Edit-2511 with the Multiple-Angles LoRA, one generation per
// direction, admitted together like Shots & Angles) and the walk-cycle sprite sheets forged from
// those views (`sprite-sheet`: per direction, Wan 2.2 walk clips whose first and last frame are
// the view, matted by BiRefNet, then the Sprite Forge custom nodes cut the loop, lock the pivot,
// mirror the east side and pack an HD and a pixel-art atlas). The custom nodes exist only in the
// self-hosted ComfyUI image, so a sheet renders only on a self-hosted target. Client-safe, and
// loadable by Node as is (relative `.ts` imports).
import { z } from "zod";

import { generationSchema, generationStatusSchema } from "../../shared/contracts.ts";
import { characterSummarySchema } from "../characters/index.ts";

/** The workflow id of one direction view, as its generation rows record it. */
export const SPRITE_VIEW_WORKFLOW = "sprite-view";

/** The workflow id of one sprite sheet, as its generation rows record it. */
export const SPRITE_SHEET_WORKFLOW = "sprite-sheet";

/** The image output of a view's generation. */
export const VIEW_OUTPUT = "image";

/**
 * A sheet generation's outputs: each atlas as an RGBA PNG (`image`) and its Aseprite JSON array
 * description (`text`, compact, under `TEXT_OUTPUT_MAX_BYTES`).
 */
export const SHEET_OUTPUTS = {
  hd: "hd",
  hdJson: "hd-json",
  pixel: "pixel",
  pixelJson: "pixel-json",
} as const;

/**
 * The five directions a set draws, in its order: south (facing the camera), south-west,
 * west, north-west and north (the back). The sheet mirrors the three turned ones into the east.
 */
export const spriteDirections = ["s", "sw", "w", "nw", "n"] as const;

export const spriteDirectionSchema = z.enum(spriteDirections);

export type SpriteDirection = z.output<typeof spriteDirectionSchema>;

/** The directions whose view is turned, so the character faces one side of the screen. */
export const turnedDirections = ["sw", "w", "nw"] as const satisfies readonly SpriteDirection[];

/** What each direction is called on the page. */
export const directionLabels: Record<SpriteDirection, string> = {
  n: "Back",
  nw: "Back three-quarter",
  s: "Front",
  sw: "Front three-quarter",
  w: "Side",
};

/** The screen side a turned view's character faces; the sheet flips rows from it. */
export const facingSchema = z.enum(["left", "right"]);

export type Facing = z.output<typeof facingSchema>;

/** The facing of each turned view, as the user confirmed it before forging. */
export const sheetFacingSchema = z.strictObject({
  nw: facingSchema,
  sw: facingSchema,
  w: facingSchema,
});

export type SheetFacing = z.output<typeof sheetFacingSchema>;

/**
 * The facing a set's page preselects: the Multiple-Angles LoRA's "right" azimuths showed the
 * character facing screen-left in the prototype (`src/features/spriteForge/README.md`).
 */
export const defaultFacing: SheetFacing = { nw: "left", sw: "left", w: "left" };

/**
 * The eight walk animations a sheet holds, in atlas row order; each atlas tag is
 * `walk_<direction>`. The east side (`ne`, `e`, `se`) mirrors `nw`, `w` and `sw`.
 */
export const sheetRows = ["s", "sw", "w", "nw", "n", "ne", "e", "se"] as const;

export type SheetRow = (typeof sheetRows)[number];

/** The atlas tag of one row. */
export function rowTag(row: SheetRow) {
  return `walk_${row}`;
}

/**
 * Walk clips rendered per direction: one, or three with different seeds of which the cleanest
 * loop (lowest seam ratio) is kept.
 */
export const sheetTakesSchema = z.union([z.literal(1), z.literal(3)]);

export type SheetTakes = z.output<typeof sheetTakesSchema>;

// A seed as the generation service stores it; a sheet renders take `t` with `seed + t - 1`.
const seedSchema = z
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 2);

/**
 * One view's generation input (the `sprite-view` workflow's `inputSchema`): the library character
 * whose image is the reference, the direction, and the seed (a set gives every view the same one).
 */
export const spriteViewInputSchema = z.strictObject({
  character_id: z.uuid(),
  direction: spriteDirectionSchema,
  seed: seedSchema.optional(),
});

export type SpriteViewInput = z.output<typeof spriteViewInputSchema>;

/**
 * One sheet's generation input (the `sprite-sheet` workflow's `inputSchema`): the done view
 * generation of each direction (its `image` output is the view), the facing of the turned views,
 * the takes per direction and the seed.
 */
export const spriteSheetInputSchema = z.strictObject({
  facing: sheetFacingSchema,
  seed: seedSchema.optional(),
  takes: sheetTakesSchema,
  views: z.strictObject({
    n: z.uuid(),
    nw: z.uuid(),
    s: z.uuid(),
    sw: z.uuid(),
    w: z.uuid(),
  }),
});

export type SpriteSheetInput = z.output<typeof spriteSheetInputSchema>;

/** `/sprites`'s search: the picked character, so a reload and a shared link keep it. */
export const spriteForgeSearchSchema = z.object({
  character: z.uuid().optional().catch(undefined),
});

/**
 * `POST /api/sprite-sets` JSON body, with a required `request_key` (a UUID): the character and
 * optionally the seed every view renders with (else one is drawn). The same key again returns
 * the set it admitted, whatever the body.
 */
export const createSpriteSetInputSchema = z.object({
  character_id: z.uuid(),
  seed: seedSchema.optional(),
});

export type CreateSpriteSetInput = z.output<typeof createSpriteSetInputSchema>;

/**
 * `POST /api/sprite-sets/:id/sheets` JSON body, with a required `request_key` (a UUID): the
 * facing of the turned views and the takes per direction. The views are the set's current ones,
 * which must all be done (409 `views_not_done`); on a Comfy Cloud target the answer is 422
 * `selfhost_required`.
 */
export const createSpriteSheetInputSchema = z.object({
  facing: sheetFacingSchema,
  takes: sheetTakesSchema,
});

export type CreateSpriteSheetInput = z.output<typeof createSpriteSheetInputSchema>;

/** The set's character as its page shows it; `null` once it is no longer in the library. */
const spriteCharacterSchema = characterSummarySchema.pick({
  id: true,
  image: true,
  is_sample: true,
  origin: true,
  title: true,
});

/**
 * One direction of a set, in its order (`position`, from 0): whether its first generation was an
 * existing one with the same recipe (`reused`, free), and its current generation (a failed or
 * cancelled one rendered again by the shared retry is followed to that child; `attempt` counts
 * them).
 */
export const spriteSetViewSchema = z.object({
  attempt: z.int().nonnegative(),
  direction: spriteDirectionSchema,
  generation: generationSchema,
  position: z.int().nonnegative(),
  reused: z.boolean(),
});

export type SpriteSetView = z.output<typeof spriteSetViewSchema>;

/** One sheet forged from a set: what it was asked for and its current generation. */
export const spriteSheetSchema = z.object({
  attempt: z.int().nonnegative(),
  created_at: z.iso.datetime(),
  facing: sheetFacingSchema,
  generation: generationSchema,
  id: z.uuid(),
  takes: sheetTakesSchema,
});

export type SpriteSheet = z.output<typeof spriteSheetSchema>;

/**
 * A sprite set: `GET /api/sprite-sets/:id`, and the answer to `POST /api/sprite-sets` (201
 * admitted now, 200 the set its request key admitted before). `sheets` is most recent first;
 * `sheets_available` says whether this server's Comfy target can forge one (a self-hosted one).
 */
export const spriteSetSchema = z.object({
  character: spriteCharacterSchema.nullable(),
  created_at: z.iso.datetime(),
  id: z.uuid(),
  seed: seedSchema,
  sheets: z.array(spriteSheetSchema),
  sheets_available: z.boolean(),
  views: z.array(spriteSetViewSchema).length(spriteDirections.length),
});

export type SpriteSet = z.output<typeof spriteSetSchema>;

/**
 * `POST /api/sprite-sets/:id/sheets`'s answer (201 admitted now, 200 the sheet its request key
 * admitted before): the sheet, and its set as it reads now.
 */
export const createdSpriteSheetSchema = z.object({
  set: spriteSetSchema,
  sheet: spriteSheetSchema,
});

export type CreatedSpriteSheet = z.output<typeof createdSpriteSheetSchema>;

/** `GET /api/sprite-sets`: the workspace's latest sets with their views' and last sheet's status. */
export const spriteSetListSchema = z.object({
  sets: z.array(
    z.object({
      character: spriteCharacterSchema.nullable(),
      created_at: z.iso.datetime(),
      id: z.uuid(),
      sheet_status: generationStatusSchema.nullable(),
      views: z
        .array(z.object({ direction: spriteDirectionSchema, status: generationStatusSchema }))
        .length(spriteDirections.length),
    }),
  ),
});

export type SpriteSetList = z.output<typeof spriteSetListSchema>;

const rectSchema = z.object({ h: z.int(), w: z.int(), x: z.int(), y: z.int() });

/**
 * The Aseprite JSON (array) a sheet's `hd-json` and `pixel-json` outputs hold, as far as the
 * playground and the downloads read it; other keys pass through untouched. `meta.loops` is Sprite
 * Forge's own: per tag, the take kept and its seam ratio (seam over motion, lower is smoother).
 */
export const atlasDescriptionSchema = z.looseObject({
  frames: z
    .array(z.looseObject({ duration: z.int().positive(), filename: z.string(), frame: rectSchema }))
    .min(1),
  meta: z.looseObject({
    frameTags: z
      .array(z.looseObject({ from: z.int().nonnegative(), name: z.string(), to: z.int() }))
      .min(1),
    image: z.string(),
    loops: z
      .array(z.object({ seam_ratio: z.number(), tag: z.string(), take: z.int().positive() }))
      .optional(),
    palette: z.array(z.string()).optional(),
    size: z.object({ h: z.int().positive(), w: z.int().positive() }),
    slices: z.array(
      z.looseObject({
        keys: z.array(
          z.looseObject({
            frame: z.int().nonnegative(),
            pivot: z.object({ x: z.int(), y: z.int() }),
          }),
        ),
        name: z.string(),
      }),
    ),
  }),
});

export type AtlasDescription = z.output<typeof atlasDescriptionSchema>;

/** A text output's atlas description, or `null` when it is not one (not JSON, or another shape). */
export function parseAtlasDescription(text: string): AtlasDescription | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = atlasDescriptionSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}
