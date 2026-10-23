// The builder's URL (`/characters/new`), so a reload, Back and Forward land on the same screen and
// follow the same generations instead of starting new ones.
import { z } from "zod";

import { carriedDraft } from "#/features/motionTransfer/api";

export const builderSteps = ["describe", "caption", "image"] as const;

export type BuilderStep = (typeof builderSteps)[number];

/**
 * - `step`: the screen; left out, it follows from the generations below.
 * - `caption`: the caption enhancement (`character-caption`) the caption screen shows.
 * - `image`: the image generation (`character-generation`) the image screen shows.
 * - `saved`: the character the image was saved as, once it was (the save is idempotent: saving
 *   again answers with the same one).
 * - `draft`: the Motion Transfer draft (motion and direction) the visitor came from, carried to
 *   "Animate this character" and the library (`carriedDraft`, Motion Transfer's public module).
 *
 * A link is untrusted: a member that does not validate is left out.
 */
export const builderSearchSchema = z.object({
  step: z.enum(builderSteps).optional().catch(undefined),
  caption: z.uuid().optional().catch(undefined),
  image: z.uuid().optional().catch(undefined),
  saved: z.uuid().optional().catch(undefined),
  draft: z
    .unknown()
    .optional()
    .transform((value) => carriedDraft(value)),
});

export type BuilderSearch = z.output<typeof builderSearchSchema>;

/** The screen `search` shows: its `step`, else the furthest one it has a generation for. */
export function shownStep({ caption, image, step }: BuilderSearch): BuilderStep {
  if (step === "image" && !image) {
    return caption ? "caption" : "describe";
  }

  return step ?? (image ? "image" : caption ? "caption" : "describe");
}
