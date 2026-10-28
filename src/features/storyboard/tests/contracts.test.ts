import assert from "node:assert/strict";
import test from "node:test";

import {
  compileCardPrompt,
  createStoryboardInputSchema,
  generateCardsInputSchema,
  parseScenes,
} from "../contracts.ts";

test("parseScenes reads the four Scene lines the text model answers with", () => {
  // Qwen3.5 4B's answer for the Theo sequence on Comfy Cloud (docs/feature-evidence/storyboard).
  const answer = [
    "Scene 1: Medium shot in a sunlit kitchen, the character stands at a counter reading a printed recipe.",
    "Scene 2: Medium shot of the same kitchen, the character cracks eggs into a bowl.",
    "Scene 3: Medium shot, the character removes a birthday cake from the oven.",
    "Scene 4: Wide shot in a dim living room at night, the character carries the lit cake.",
  ].join("\n");

  assert.deepEqual(parseScenes(answer), [
    "Medium shot in a sunlit kitchen, the character stands at a counter reading a printed recipe.",
    "Medium shot of the same kitchen, the character cracks eggs into a bowl.",
    "Medium shot, the character removes a birthday cake from the oven.",
    "Wide shot in a dim living room at night, the character carries the lit cake.",
  ]);

  // Run together on one line, as the FLUX 3 upsampler once answered: still four scenes.
  assert.deepEqual(parseScenes("Scene 1: A. Scene 2: B. Scene 3: C. Scene 4: D."), [
    "A.",
    "B.",
    "C.",
    "D.",
  ]);
});

test("parseScenes refuses an answer that is not exactly four numbered scenes, rather than guessing", () => {
  // The fake provider's text, a single caption.
  assert.equal(parseScenes("A full-body photograph of a single adult character."), null);
  assert.equal(parseScenes("Scene 1: A.\nScene 2: B.\nScene 3: C."), null);
  assert.equal(
    parseScenes("Scene 1: A.\nScene 2: B.\nScene 3: C.\nScene 4: D.\nScene 5: E."),
    null,
  );
  assert.equal(parseScenes("Scene 1: A.\nScene 3: B.\nScene 2: C.\nScene 4: D."), null);
  assert.equal(parseScenes("Scene 1: A.\nScene 2:\nScene 3: C.\nScene 4: D."), null);
  assert.equal(
    parseScenes(`Scene 1: ${"x".repeat(1001)}\nScene 2: B\nScene 3: C\nScene 4: D`),
    null,
  );
});

test("compileCardPrompt frames every card the same way and names the style", () => {
  assert.equal(
    compileCardPrompt(
      "  Wide shot on a rooftop at sunset, the character stretches.  ",
      "reference",
    ),
    "A storyboard frame. The character is the person in the reference image. Wide shot on a rooftop at sunset, the character stretches. Keep the character's face, hair, body and outfit exactly as in the reference image. Render it in the same visual style as the reference image, cinematic wide 16:9 composition, no text, no captions, no borders.",
  );
  assert.match(
    compileCardPrompt("A scene.", "anime"),
    /Render it as an anime-style illustration in the same visual style/,
  );
});

test("request bodies: a style defaults to the reference's, positions are distinct cards 0-3", () => {
  const created = createStoryboardInputSchema.parse({
    character_id: "6f0c3c1e-7a4b-4c8e-9f51-2d6f0a4b1c11",
    request_key: "0b9f3c2e-1a4d-4e8f-9c51-3d7f1a5b2c22",
    sequence: "  Theo bakes a cake.  ",
  });

  assert.equal(created.style, "reference");
  assert.equal(created.sequence, "Theo bakes a cake.");
  assert.equal("request_key" in created, false);

  const descriptions = ["A", "B", "C", ""];
  const body = { descriptions, style: "reference", title: "" };

  assert.equal(generateCardsInputSchema.safeParse({ ...body, positions: [1] }).success, true);
  assert.equal(generateCardsInputSchema.parse({ ...body, positions: [1] }).title, null);
  assert.equal(generateCardsInputSchema.safeParse({ ...body, positions: [] }).success, false);
  assert.equal(generateCardsInputSchema.safeParse({ ...body, positions: [1, 1] }).success, false);
  assert.equal(generateCardsInputSchema.safeParse({ ...body, positions: [4] }).success, false);
  assert.equal(
    generateCardsInputSchema.safeParse({ ...body, descriptions: ["A"], positions: [0] }).success,
    false,
  );
});
