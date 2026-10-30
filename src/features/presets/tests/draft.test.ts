import assert from "node:assert/strict";
import test from "node:test";

import { defaultStringifySearch } from "@tanstack/react-router";

import {
  draftHref,
  parseDraft,
  sampleCharacterId,
  sampleMotionId,
} from "../../motionTransfer/api.ts";
import { type Preset, presetSchema, presets } from "../catalog.ts";
import { presetGenerateInputSchema } from "../contracts.ts";
import {
  directionSearch,
  lookSummary,
  presetDirection,
  presetDraft,
  presetRequest,
  presetSearchSchema,
  reconciledDirection,
  resolveDirection,
} from "../draft.ts";

const [shipped] = presets;

assert.ok(shipped);

// A preset whose seed is not Motion Transfer's fixed default, so a reset to it shows.
const preset: Preset = presetSchema.parse({
  ...shipped,
  defaults: { prompt: "A look of the preset.", seed: 7 },
});

test("the page's search decodes like a draft: the version, the character and the direction members; anything invalid is dropped", () => {
  assert.deepEqual(
    presetSearchSchema.parse({
      character: sampleCharacterId,
      prompt: "Mine.",
      seed: 9,
      version: 2,
    }),
    { character: sampleCharacterId, prompt: "Mine.", seed: 9, version: 2 },
  );
  assert.deepEqual(presetSearchSchema.parse({ prompt: "", seed: "default" }), {
    prompt: "",
    seed: "default",
  });
  assert.deepEqual(
    presetSearchSchema.parse({
      character: "not-a-uuid",
      motion: sampleMotionId,
      prompt: "x".repeat(501),
      seed: -1,
      version: 0,
    }),
    { character: undefined, prompt: undefined, seed: undefined, version: undefined },
  );
});

test("the form starts with the preset's look and seed, and each one the search sets over it", () => {
  assert.deepEqual(presetDirection(preset, {}), { prompt: "A look of the preset.", seed: "7" });
  assert.deepEqual(presetDirection(preset, { prompt: "Mine.", seed: 42 }), {
    prompt: "Mine.",
    seed: "42",
  });
  assert.deepEqual(presetDirection(preset, { prompt: "", seed: "default" }), {
    prompt: "",
    seed: "",
  });
});

test("an edit goes to the search only where it differs from the preset, as the draft says it, and never in a form the draft refuses", () => {
  assert.deepEqual(directionSearch(preset, { prompt: "A look of the preset.", seed: "7" }), {
    prompt: undefined,
    seed: undefined,
  });
  assert.deepEqual(directionSearch(preset, { prompt: "Mine.", seed: " 42 " }), {
    prompt: "Mine.",
    seed: 42,
  });
  assert.deepEqual(directionSearch(preset, { prompt: "  ", seed: "" }), {
    prompt: "",
    seed: "default",
  });
  assert.deepEqual(directionSearch(preset, { prompt: "x".repeat(501), seed: "4x" }), {
    prompt: undefined,
    seed: undefined,
  });

  // Round trip: the search an edit makes gives the form back.
  const edit = { prompt: "Mine.", seed: "42" };

  assert.deepEqual(presetDirection(preset, directionSearch(preset, edit)), edit);
});

test("Generate sends the version, the character and only the changes; the schema refuses a missing character and a seed that is not a number", () => {
  assert.deepEqual(
    presetGenerateInputSchema.parse(
      presetRequest(preset, sampleCharacterId, { prompt: "A look of the preset.", seed: "7" }),
    ),
    // Left out of the JSON body: the preset's own look and seed.
    { character_id: sampleCharacterId, prompt: undefined, seed: undefined, version: 1 },
  );
  assert.deepEqual(
    presetGenerateInputSchema.parse(
      presetRequest(preset, sampleCharacterId, { prompt: "", seed: "" }),
    ),
    { character_id: sampleCharacterId, prompt: "", seed: "default", version: 1 },
  );

  const refused = presetGenerateInputSchema.safeParse(
    presetRequest(preset, undefined, { prompt: "A look of the preset.", seed: "4x" }),
  );

  assert.deepEqual(
    new Set(refused.error?.issues.map(({ path }) => path[0])),
    new Set(["character_id", "seed"]),
  );
});

test("when the preset or the search changes under the form, the form follows them unless it already says the same", () => {
  // A refreshed catalog: version 2 has another look and seed; the form still shows version 1's.
  const next: Preset = presetSchema.parse({
    ...preset,
    defaults: { prompt: "The look of version two.", seed: 8 },
    version: 2,
  });

  const shown = presetDirection(preset, {});

  assert.deepEqual(reconciledDirection(next, {}, shown), {
    prompt: "The look of version two.",
    seed: "8",
  });
  // The visitor's own changes are in the search, so they survive the refresh.
  assert.deepEqual(reconciledDirection(next, { prompt: "Mine.", seed: 42 }, shown), {
    prompt: "Mine.",
    seed: "42",
  });

  // Back or Forward to another entry: its seed replaces the form's.
  assert.deepEqual(reconciledDirection(preset, { seed: 5 }, { ...shown, seed: "6" }), {
    prompt: "A look of the preset.",
    seed: "5",
  });

  // An edit the search already holds stays as typed, padding included; so does a seed that is
  // not a number yet, which the search leaves out.
  const typed = { prompt: "Mine.", seed: " 42" };

  assert.equal(reconciledDirection(preset, { prompt: "Mine.", seed: 42 }, typed), typed);

  const unfinished = { prompt: "A look of the preset.", seed: "4x" };

  assert.equal(reconciledDirection(preset, {}, unfinished), unfinished);
});

test("the server resolves each member into the preset's value, the visitor's, or Motion Transfer's default for a reset", () => {
  assert.deepEqual(resolveDirection(preset, {}), { prompt: "A look of the preset.", seed: 7 });
  assert.deepEqual(resolveDirection(preset, { prompt: "Mine.", seed: 42 }), {
    prompt: "Mine.",
    seed: 42,
  });
  assert.deepEqual(resolveDirection(preset, { prompt: "", seed: "default" }), {
    prompt: undefined,
    seed: undefined,
  });
});

test("a preset becomes a valid Motion Transfer draft with its motion and resolved direction, on Character without a character and on Direct with one", () => {
  const asked = presetDraft(preset, sampleMotionId, {});

  assert.deepEqual(asked, {
    motion: sampleMotionId,
    prompt: "A look of the preset.",
    seed: 7,
    step: "character",
  });
  assert.deepEqual(parseDraft(asked), asked);

  const picked = presetDraft(preset, sampleMotionId, {
    character: sampleCharacterId,
    prompt: "",
    seed: "default",
  });

  assert.deepEqual(picked, {
    character: sampleCharacterId,
    motion: sampleMotionId,
    prompt: "",
    seed: "default",
    step: "direct",
  });
  assert.equal(draftHref(picked), `/motionTransfer${defaultStringifySearch(picked)}`);
  assert.match(draftHref(picked), /^\/motionTransfer\?/);
});

test("the look row says what the look comes to, and whether it is still the preset's", () => {
  const withBackground = presetSchema.parse({
    ...shipped,
    defaults: { prompt: "Someone. Background: a neon-lit street at night. Soft.", seed: 7 },
  });

  assert.deepEqual(lookSummary(withBackground, withBackground.defaults.prompt), {
    caption: "Background from this preset",
    own: false,
    title: "A neon-lit street at night",
  });
  assert.deepEqual(lookSummary(shipped, shipped.defaults.prompt), {
    caption: "Look from this preset",
    own: false,
    title: "As in your photo",
  });
  assert.deepEqual(lookSummary(withBackground, "Background: a beach, at dawn"), {
    caption: "Your look",
    own: true,
    title: "A beach, at dawn",
  });
  assert.deepEqual(lookSummary(withBackground, "  "), {
    caption: "Your look",
    own: true,
    title: "As in your photo",
  });
  assert.deepEqual(lookSummary(withBackground, "A dancer on a rooftop."), {
    caption: "Your look",
    own: true,
    title: "A dancer on a rooftop.",
  });
});
