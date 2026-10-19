import { createHash } from "node:crypto";

import { z } from "zod";

import { motionTransferParamsSchema } from "./workflows/params.ts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Everything that determines a render, and nothing else: no timestamps, ids, keys or URLs.
 * Strict objects, so a stray field fails instead of silently changing (or not changing) the hash.
 */
export const recipeSchema = z.strictObject({
  inputs: z.strictObject({
    driving_video_sha256: sha256Schema,
    reference_image_sha256: sha256Schema,
  }),
  // Entries of models.lock (Step 8.1); recipes carry an empty list until it exists.
  models: z.array(
    z.strictObject({ file: z.string().min(1), license: z.string().min(1), sha256: sha256Schema }),
  ),
  // The provider's asset references differ per upload; the input hashes above identify the files.
  params: z.strictObject(
    motionTransferParamsSchema.omit({ driving_video: true, reference_image: true }).shape,
  ),
  target: z.enum(["cloud", "selfhost"]),
  workflow: z.strictObject({
    id: z.string().min(1),
    sha256: sha256Schema,
    version: z.int().positive(),
  }),
});

export type Recipe = z.infer<typeof recipeSchema>;

type Json = boolean | number | string | null | Json[] | { [key: string]: Json };

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the recipe was parsed by recipeSchema; this only tells JSON objects from JSON scalars to serialize them.
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const members = Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);

  return `{${members.join(",")}}`;
}

/** SHA-256 of the recipe as canonical JSON (keys sorted at every level), in hex. */
export function recipeHash(recipe: Recipe) {
  return createHash("sha256")
    .update(canonicalJson(recipeSchema.parse(recipe)))
    .digest("hex");
}
