// The batches feature's contracts (DEV-292): a batch is several variations of one Motion
// Transfer shot, admitted at once through the generation service (`submitMany`) and compared
// side by side at `/batches/:id`. Client-safe, and loadable by Node as is (relative `.ts`
// imports), so `npm run test:server` exercises them.
import { z } from "zod";

import {
  allowanceSchema,
  assetSchema,
  generationSchema,
  generationStatusSchema,
} from "../../shared/contracts.ts";
import { characterSummarySchema } from "../characters/index.ts";
import { type DraftSnapshot, parseDraft, snapshotDraft } from "../motionTransfer/api.ts";

/** How many seed variations a batch may have: two or four. */
export const SEED_COUNTS = [2, 4] as const;

/** How many characters one shot may be applied to at once. */
export const MIN_CHARACTERS = 2;

export const MAX_CHARACTERS = 6;

// A seed as Motion Transfer's draft and `POST /api/generate` take it.
const seedSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * What varies across a batch's items, the rest of the shot staying as it is:
 *
 * - `seeds`: two or four distinct seeds, each item the shot with one of them (`withSeed`);
 * - `characters`: two to six distinct characters, each item the shot with one of them
 *   (`withCharacter`), with the shot's motion, look and seed in common.
 */
export const batchVariationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("seeds"),
    seeds: z
      .array(seedSchema)
      .refine((seeds) => SEED_COUNTS.some((count) => count === seeds.length), {
        message: `A seed batch has ${SEED_COUNTS.join(" or ")} seeds.`,
      })
      .refine((seeds) => new Set(seeds).size === seeds.length, {
        message: "Every seed of a batch is different.",
      }),
  }),
  z.object({
    characters: z
      .array(z.uuid())
      .min(MIN_CHARACTERS)
      .max(MAX_CHARACTERS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Every character of a batch is different.",
      }),
    kind: z.literal("characters"),
  }),
]);

export type BatchVariation = z.output<typeof batchVariationSchema>;

export type BatchKind = BatchVariation["kind"];

/**
 * The shot a batch varies: a Motion Transfer `DraftSnapshot` (motion, character, `from`, look and
 * seed). Unlike `parseDraft`, a member that does not validate is refused rather than dropped, so
 * a batch never renders a shot other than the one asked for. The motion is required.
 */
const shotSchema = z.record(z.string(), z.json()).transform((raw, context): DraftSnapshot => {
  const parsed = parseDraft(raw);

  for (const key of Object.keys(raw)) {
    if (key === "step" || !(key in parsed)) {
      context.addIssue({ code: "custom", message: `The shot's ${key} is not valid.`, path: [key] });
    }
  }

  if (!parsed.motion) {
    context.addIssue({ code: "custom", message: "The shot needs a motion.", path: ["motion"] });
  }

  return snapshotDraft(parsed);
});

/**
 * `POST /api/batches` JSON body, with a required `request_key` (a UUID): the same key again
 * returns the batch the first request admitted, whatever its body. A seed batch needs the
 * shot's character.
 */
export const createBatchInputSchema = z
  .object({ shot: shotSchema, variation: batchVariationSchema })
  .refine(({ shot, variation }) => variation.kind !== "seeds" || shot.character !== undefined, {
    message: "A seed batch needs the shot's character.",
    path: ["shot", "character"],
  });

export type CreateBatchInput = z.output<typeof createBatchInputSchema>;

/** A stored file as a batch's pages name it: what its `/media` URL takes. */
const batchMediaSchema = assetSchema.pick({ id: true, mime: true });

/** A batch item's character as the batch page shows it; `null` when the visitor may not see it. */
const batchCharacterSchema = characterSummarySchema.pick({
  id: true,
  image: true,
  is_sample: true,
  origin: true,
  title: true,
});

export type BatchCharacter = z.output<typeof batchCharacterSchema>;

/**
 * One item of a batch, in its order (`position`, from 0):
 *
 * - `variation`: what this item was asked to vary (its seed, or its character);
 * - `reused`: its first generation was an existing one with the same recipe (a take done or on
 *   its way), returned free instead of rendered again;
 * - `generation`: the item's current generation, a snapshot as `GET /api/generations/:id` has
 *   it. A failed or cancelled one rendered again (the shared retry with a new seed, or a re-run
 *   with the same one) is followed to that child; `attempt` counts them (0: the first generation);
 * - `seed`: the seed the current generation renders with (its recipe's), and `character` the
 *   character it animates.
 */
export const batchItemSchema = z.object({
  attempt: z.int().nonnegative(),
  character: batchCharacterSchema.nullable(),
  generation: generationSchema,
  position: z.int().nonnegative(),
  reused: z.boolean(),
  seed: seedSchema.nullable(),
  variation: z.union([
    z.object({ seed: seedSchema }).strict(),
    z.object({ character_id: z.uuid() }).strict(),
  ]),
});

export type BatchItem = z.output<typeof batchItemSchema>;

/**
 * A batch: `GET /api/batches/:id`, and the answer to `POST /api/batches` (201 admitted now, 200
 * the batch its request key admitted before). `shot` is the common shot (for a character batch,
 * without the character each item sets), and `motion` its clip, with the sample motion's title
 * (`null` for the visitor's own clip).
 */
export const batchSchema = z.object({
  created_at: z.iso.datetime(),
  id: z.uuid(),
  items: z.array(batchItemSchema).min(1),
  kind: z.enum(["seeds", "characters"]),
  motion: z.object({ asset: batchMediaSchema, title: z.string().nullable() }).nullable(),
  shot: z.record(z.string(), z.union([z.string(), z.number()])),
});

export type Batch = z.output<typeof batchSchema>;

/**
 * `GET /api/batches` (a session is needed): the workspace's batches, most recent first, each
 * with the status of every item's current generation in order and a picture of each (its poster,
 * else its character's image), and the session's allowance.
 */
export const batchListSchema = z.object({
  allowance: allowanceSchema,
  batches: z.array(
    z.object({
      created_at: z.iso.datetime(),
      id: z.uuid(),
      kind: z.enum(["seeds", "characters"]),
      statuses: z.array(generationStatusSchema).min(1),
      thumbnails: z.array(batchMediaSchema.nullable()).min(1),
    }),
  ),
});

export type BatchList = z.output<typeof batchListSchema>;
