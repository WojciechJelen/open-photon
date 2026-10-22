import { createHash } from "node:crypto";

/**
 * A JSON value as a recipe holds it. An `undefined` member is absent, as in `JSON.stringify`: an
 * optional field left unset.
 */
export type Json = boolean | number | string | null | Json[] | { [key: string]: Json | undefined };

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- the recipe was parsed by its workflow's schema; this only tells JSON objects from JSON scalars to serialize them.
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const members = Object.entries(value)
    .flatMap(([key, member]) => (member === undefined ? [] : [[key, member] as const]))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);

  return `{${members.join(",")}}`;
}

/**
 * SHA-256 of the recipe as canonical JSON (keys sorted at every level), in hex: the identity a
 * result is reused by. Hash the value the workflow's recipe schema parsed, so a stray field fails
 * there instead of silently changing (or not changing) the hash. Historical Motion Transfer
 * recipes hash as they always did (`historical-recipes.json`).
 */
export function recipeHash(recipe: Json) {
  return createHash("sha256").update(canonicalJson(recipe)).digest("hex");
}
