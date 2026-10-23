// Explore's contracts: what the gallery (`/explore`) and an example's page (`/explore/:slug`) read
// from the server (`server/catalog.ts`), and the gallery's search. Client-safe, and loadable by
// Node as is (relative `.ts` imports), so the server and its tests parse what they answer with.
import { z } from "zod";

import { assetSchema } from "../../shared/contracts.ts";
import { motionTransferDraftSchema } from "../motionTransfer/api.ts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** The motion key of an example whose clip is not a sample motion's (an upload or a cut). */
export const OWN_CLIP = "own-clip";

/**
 * The gallery's filters, held in the URL of `/explore`: `motion` (a sample motion's slug, or
 * `OWN_CLIP`) and `look` (a look's key, `lookKey`). A link is untrusted: a value that does not
 * validate comes out `undefined`, which is no filter.
 */
export const exploreSearchSchema = z.object({
  motion: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .optional()
    .catch(undefined),
  look: z
    .string()
    .regex(/^[a-f0-9]{12}$/)
    .optional()
    .catch(undefined),
});

export type ExploreSearch = z.output<typeof exploreSearchSchema>;

/**
 * The look an example was made with: its text exactly as the recipe holds it (`text`), a short
 * name for a filter chip (`label`) and a stable key for the URL (`key`).
 */
const lookSchema = z.object({ key: z.string(), label: z.string(), text: z.string() });

/**
 * The motion an example performs: a sample motion (`sample`, keyed by its slug, with its title),
 * or a clip of someone's own (`OWN_CLIP`), which is never shown.
 */
const motionTagSchema = z.object({ key: z.string(), sample: z.boolean(), title: z.string() });

/**
 * "Make this with my character": the Motion Transfer draft that recreates the example (validated
 * by Motion Transfer's `parseDraft`): `from` the example, so the wizard starts from its look and
 * seed, and its motion clip when that clip is public (`motionKept`); `href` opens the wizard on
 * it (`draftHref`), at character selection when the motion is kept, else at motion selection.
 * Opening it submits nothing.
 */
const remixSchema = z.object({
  draft: motionTransferDraftSchema,
  href: z.string().startsWith("/motionTransfer"),
  motionKept: z.boolean(),
});

/**
 * One example of the gallery: a published pre-rendered take (its share page `slug`), titled by
 * its character and motion, with its result and poster (public, like its share page), the
 * character's title when a visitor may see that character, its look and seed, and its remix.
 */
export const exploreEntrySchema = z.object({
  characterTitle: z.string().nullable(),
  id: z.uuid(),
  look: lookSchema,
  motion: motionTagSchema,
  poster: assetSchema.nullable(),
  remix: remixSchema,
  result: assetSchema,
  seed: z.int().nonnegative(),
  slug: z.string(),
  title: z.string(),
});

export type ExploreEntry = z.output<typeof exploreEntrySchema>;

/**
 * An example's page: the entry, its inputs as far as they are public (`source`: the motion clip
 * when it is a sample motion's; `character`: a character a visitor may see, its `image` only when
 * it is the very image the take was made from), the side-by-side (`compare`, when it was
 * stitched), the readable recipe, when it finished, and its public share page and recipe JSON.
 */
export const exploreDetailSchema = exploreEntrySchema.extend({
  character: z.object({ image: assetSchema.nullable(), title: z.string().nullable() }).nullable(),
  compare: assetSchema.nullable(),
  finishedAt: z.iso.datetime().nullable(),
  pageUrl: z.string(),
  recipe: z.object({
    fragmentLength: z.int(),
    height: z.int(),
    models: z.array(z.object({ file: z.string(), license: z.string(), sha256: sha256Schema })),
    target: z.enum(["cloud", "selfhost"]),
    width: z.int(),
    workflow: z.object({ id: z.string(), sha256: sha256Schema, version: z.int() }),
  }),
  recipeUrl: z.string(),
  source: assetSchema.nullable(),
});

export type ExploreDetail = z.output<typeof exploreDetailSchema>;
