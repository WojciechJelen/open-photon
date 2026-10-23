import { z } from "zod";

import { assetSchema } from "../../shared/contracts.ts";

/**
 * A `characters` row as the API shows it. `POST /api/characters` takes multipart `image` (PNG,
 * JPEG or WebP by content, at most 128 MiB) and `consent=true`, the uploader's statement that they
 * may use the likeness. 201 with the new character (`origin: "upload"`, `consent_at` set), 200
 * with the stored one when the same image was uploaded before; either answer is a
 * `characterSummarySchema`, which extends this. 422 `{ error, reason }` with `consent_required` or
 * `not_image`; nothing is stored then.
 */
export const characterSchema = z.object({
  consent_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  generation_id: z.uuid().nullable(),
  id: z.uuid(),
  image_asset_id: z.uuid(),
  is_sample: z.boolean(),
  origin: z.enum(["generated", "upload"]),
  prompt: z.string().nullable(),
  slug: z.string().nullable(),
  title: z.string().nullable(),
});

/** A character with its reference image's asset, as the picker shows it. */
export const pickableCharacterSchema = characterSchema.extend({ image: assetSchema });

export type PickableCharacter = z.infer<typeof pickableCharacterSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * What a generated character was made with, copied from its generation's stored recipe when it
 * was saved: the workflow file (id, version, SHA-256) and the model files it loads.
 */
const characterProvenanceSchema = z.object({
  models: z.array(z.object({ file: z.string(), license: z.string(), sha256: sha256Schema })),
  workflow: z.object({ id: z.string(), sha256: sha256Schema, version: z.int().positive() }),
});

export type CharacterProvenance = z.infer<typeof characterProvenanceSchema>;

/**
 * A character of the workspace library, as every read of the characters feature returns it
 * (`getCharacter`, `listCharacters`, the writes): the row with its image, when it was marked a
 * favorite (`favorite_at`, `null` when it is not one), when it was last renamed or (un)favorited
 * (`updated_at`, `null` until then) and, for one saved from a generation, its `provenance`.
 */
export const characterSummarySchema = pickableCharacterSchema.extend({
  favorite_at: z.iso.datetime().nullable(),
  provenance: characterProvenanceSchema.nullable(),
  updated_at: z.iso.datetime().nullable(),
});

export type CharacterSummary = z.infer<typeof characterSummarySchema>;

/** A character's title as a user gives it: trimmed, 1–80 characters. */
export const characterTitleSchema = z.string().trim().min(1).max(80);

/**
 * `PATCH /api/characters/:id` JSON body (a session is needed): a new `title`
 * (`characterTitleSchema`), `favorite` to mark or unmark it, or both. 200 with the character
 * (`characterSummarySchema`); 400 for a body that is none of these; 404 for an id no character
 * has; 409 `{ error, reason: "sample" }` for a new title on a sample, whose title is the
 * manifest's.
 */
export const characterPatchSchema = z
  .object({ favorite: z.boolean().optional(), title: characterTitleSchema.optional() })
  .strict()
  .refine((patch) => patch.favorite !== undefined || patch.title !== undefined, {
    message: "Give a title, favorite, or both.",
  });

// A `0`/`1` flag of a query string.
const queryFlag = z.enum(["0", "1"]).optional();

/**
 * The query of `GET /api/characters` (a session is needed; 401 without one), the workspace
 * library: `q` keeps the characters whose title or prompt contains it, case-insensitively
 * (trimmed, at most 200 characters; blank is no filter); `favorites=1` only the favorites;
 * `samples=0` leaves the sample characters out (`1`, the default, lists them too). 400 for a
 * query that is not this.
 */
export const characterListQuerySchema = z.object({
  favorites: queryFlag.transform((flag) => flag === "1"),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((query) => query || undefined),
  samples: queryFlag.transform((flag) => flag !== "0"),
});

export type CharacterListQuery = z.output<typeof characterListQuerySchema>;

/**
 * The answer to `GET /api/characters`: the workspace's characters and the sample ones the query
 * keeps (`characterListQuerySchema`), most recent first (`created_at` descending, then `id`).
 */
export const characterListSchema = z.object({ characters: z.array(characterSummarySchema) });

export type CharacterList = z.output<typeof characterListSchema>;
