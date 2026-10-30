import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { lookLabels } from "../look-labels.ts";

// What the looks editor composes (`src/features/looks/compose.ts`): the character sentence, the
// default background sentence unless a background is picked, then one fragment per pick.
const character = "The character from the reference image, as it appears there.";
const photoBackground = "Background as in the reference image.";
const beach = "Background: a sunny sandy beach with the blue sea and sky behind.";
const neonGlow = "Lighting: magenta and cyan neon light on the character.";

test("one look is named by its first sentence", () => {
  assert.deepEqual(
    [...lookLabels([{ key: "a", text: "A red raincoat. In the rain." }])],
    [["a", "A red raincoat"]],
  );
  assert.deepEqual(
    [...lookLabels([{ key: "a", text: "e2e seeded result" }])],
    [["a", "e2e seeded result"]],
  );
});

test("a composed look alone is named by its picks, not by the sentences it leads with", () => {
  assert.equal(
    lookLabels([{ key: "a", text: `${character} ${beach}` }]).get("a"),
    "A sunny sandy beach with the blue sea and…",
  );
  assert.equal(
    lookLabels([{ key: "a", text: character }]).get("a"),
    "The character from the reference image, as…",
  );
});

test("the workflow's default look is From the photo, alone and among others", () => {
  const { prompt } = JSON.parse(
    readFileSync("src/features/motionTransfer/workflows/defaults.json", "utf8"),
  );

  assert.equal(lookLabels([{ key: "a", text: prompt }]).get("a"), "From the photo");
  assert.equal(
    lookLabels([
      { key: "a", text: prompt },
      { key: "b", text: `${character} ${beach}` },
    ]).get("a"),
    "From the photo",
  );
});

test("looks editor sentences: the character sentence every look shares is left out, and each look reads apart", () => {
  const labels = lookLabels([
    { key: "default", text: `${character} ${photoBackground}` },
    { key: "beach", text: `${character} ${beach}` },
    { key: "glow", text: `${character} ${photoBackground} ${neonGlow}` },
    { key: "beach-glow", text: `${character} ${beach} ${neonGlow}` },
  ]);

  assert.deepEqual(Object.fromEntries(labels), {
    beach: "A sunny sandy beach with the blue sea and…",
    "beach-glow": "A sunny sandy beach… · Magenta and cyan…",
    default: "From the photo",
    glow: "Magenta and cyan neon light on the character",
  });

  for (const label of labels.values()) {
    assert.ok(label.length <= 44, label);
  }
});

test("a look's own words stay as typed, and an empty look has a name", () => {
  const labels = lookLabels([
    { key: "own", text: "A red raincoat, standing in the rain" },
    { key: "empty", text: "" },
  ]);

  assert.equal(labels.get("own"), "A red raincoat, standing in the rain");
  assert.equal(labels.get("empty"), "No look");
});
