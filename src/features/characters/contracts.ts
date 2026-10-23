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
