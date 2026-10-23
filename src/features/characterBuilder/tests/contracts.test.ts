import assert from "node:assert/strict";
import test from "node:test";

import {
  CHARACTER_FRAMING,
  characterCaptionInputSchema,
  characterControlsSchema,
  characterGenerationInputSchema,
  compileCharacterRequest,
  saveCharacterInputSchema,
} from "../contracts.ts";
import {
  captionGenerationFixture,
  captionInputFixture,
  enhancedCaptionFixture,
  generationInputFixture,
  imageGenerationFixture,
  savedCharacterFixture,
} from "./fixtures.ts";

test("compileCharacterRequest folds the controls into the description and asks for full-body framing", () => {
  assert.equal(
    compileCharacterRequest("A street musician", {
      appearance: "Red curly hair",
      outfit: "A mustard raincoat.",
      style: "anime",
    }),
    `A street musician. Appearance: Red curly hair. Outfit: A mustard raincoat. Style: an anime-style illustration with clean line art and cel shading. ${CHARACTER_FRAMING}`,
  );

  // Without controls: the description and the framing only; the same input, the same request.
  assert.equal(compileCharacterRequest("  A knight!  "), `A knight! ${CHARACTER_FRAMING}`);
  assert.equal(
    compileCharacterRequest(captionInputFixture.description, captionInputFixture.controls),
    compileCharacterRequest(captionInputFixture.description, captionInputFixture.controls),
  );
  assert.match(
    CHARACTER_FRAMING,
    /single person.*head to toe.*hands.*feet.*neutral pose.*plain.*even/,
  );
});

test("controls are optional, trimmed, at most 200 characters; blank is none; the style is one of four", () => {
  assert.deepEqual(characterControlsSchema.parse({ appearance: "  ", outfit: " A coat " }), {
    appearance: undefined,
    outfit: "A coat",
  });
  assert.equal(characterControlsSchema.safeParse({ outfit: "a".repeat(201) }).success, false);
  assert.equal(characterControlsSchema.safeParse({ style: "watercolour" }).success, false);
  assert.equal(characterControlsSchema.safeParse({ style: "stylized-3d" }).success, true);
});

test("a caption request needs a description of 1–1000 characters once trimmed", () => {
  assert.equal(characterCaptionInputSchema.safeParse({ description: "   " }).success, false);
  assert.equal(
    characterCaptionInputSchema.safeParse({ description: "a".repeat(1001) }).success,
    false,
  );
  assert.deepEqual(characterCaptionInputSchema.parse({ description: " A knight " }), {
    description: "A knight",
  });
});

test("a generation request keeps its caption byte for byte and refuses a blank one", () => {
  const caption = "  A knight in silver armour.\n";

  assert.equal(characterGenerationInputSchema.parse({ caption }).caption, caption);
  assert.equal(characterGenerationInputSchema.safeParse({ caption: " \n\t" }).success, false);
  assert.equal(
    characterGenerationInputSchema.safeParse({ caption: "a".repeat(4001) }).success,
    false,
  );
  assert.equal(
    characterGenerationInputSchema.safeParse({ caption, width: 1000 }).success,
    false,
    "a side is a multiple of 16",
  );
  assert.equal(
    characterGenerationInputSchema.safeParse({ caption, source: { caption_generation_id: "x" } })
      .success,
    false,
  );
  assert.deepEqual(saveCharacterInputSchema.parse({ title: " Knight " }), { title: "Knight" });
  assert.equal(saveCharacterInputSchema.safeParse({ title: "" }).success, false);
});

test("the fixtures hold together: caption text inline, image output, character saved from it", () => {
  assert.deepEqual(captionGenerationFixture.outputs, [
    { media: "text", name: "caption", text: enhancedCaptionFixture },
  ]);
  assert.equal(generationInputFixture.source?.caption_generation_id, captionGenerationFixture.id);
  assert.notEqual(generationInputFixture.caption, enhancedCaptionFixture);

  const [image] = imageGenerationFixture.outputs;

  assert.equal(image?.media, "image");
  assert.equal(savedCharacterFixture.generation_id, imageGenerationFixture.id);
  assert.equal(
    savedCharacterFixture.image_asset_id,
    image?.media === "image" ? image.asset.id : "",
  );
  assert.equal(savedCharacterFixture.prompt, generationInputFixture.caption);
});
