// The definition's module opens the database: this test gets its own, outside `data/`.
import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { z } from "zod";

import { recipeHash } from "../../../shared/server/generation/recipe-hash.ts";
import { motionTransferDefinition } from "../workflows/definition.ts";

/**
 * Recipes as `generations.recipe` stores them, with the `recipe_hash` stored beside them: real rows
 * of a development database (no angle, no model pins, both targets) and the shapes added since
 * (an angle, model pins), hashed by the code before the generation service moved to shared.
 */
const fixtures = z
  .array(
    z.object({
      recipe: z.string(),
      recipe_hash: z.string().regex(/^[a-f0-9]{64}$/),
      source: z.string(),
    }),
  )
  .parse(
    JSON.parse(readFileSync(new URL("fixtures/historical-recipes.json", import.meta.url), "utf8")),
  );

test("every historical recipe shape still decodes and hashes to its recorded recipe_hash", () => {
  assert.ok(fixtures.length >= 4);

  for (const { recipe, recipe_hash, source } of fixtures) {
    const decoded = motionTransferDefinition.recipeSchema.parse(JSON.parse(recipe));

    assert.equal(recipeHash(decoded), recipe_hash, source);
  }
});
