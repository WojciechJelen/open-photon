import assert from "node:assert/strict";
import test from "node:test";

import { type Recipe, recipeHash } from "../src/features/genjutsu/server/recipe.ts";

const recipe: Recipe = {
  inputs: { driving_video_sha256: "a".repeat(64), reference_image_sha256: "b".repeat(64) },
  models: [],
  params: { fragment_length: 81, height: 848, prompt: "A dancer", seed: 7, width: 480 },
  target: "cloud",
  workflow: { id: "motion-transfer", sha256: "c".repeat(64), version: 1 },
};

test("recipe_hash follows the params, not their key order", () => {
  const hash = recipeHash(recipe);

  assert.equal(recipeHash(structuredClone(recipe)), hash);

  const reordered: Recipe = {
    workflow: { version: 1, sha256: "c".repeat(64), id: "motion-transfer" },
    target: "cloud",
    params: { width: 480, seed: 7, prompt: "A dancer", height: 848, fragment_length: 81 },
    models: [],
    inputs: { reference_image_sha256: "b".repeat(64), driving_video_sha256: "a".repeat(64) },
  };

  assert.equal(recipeHash(reordered), hash);

  const changes: Partial<Recipe["params"]>[] = [
    { fragment_length: 77 },
    { height: 832 },
    { prompt: "A dancer in the rain" },
    { seed: 8 },
    { width: 464 },
  ];

  for (const change of changes) {
    assert.notEqual(recipeHash({ ...recipe, params: { ...recipe.params, ...change } }), hash);
  }

  // An angle changes the hash; no angle hashes as a recipe from before angles existed.
  assert.notEqual(recipeHash({ ...recipe, angle: "profile" }), hash);
  assert.equal(recipeHash({ ...recipe, angle: undefined }), hash);
});
