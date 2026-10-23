import assert from "node:assert/strict";
import test from "node:test";

import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { z } from "zod";

// Through the public module, as another feature's test would.
import {
  carriedDraft,
  carryDraft,
  directionFixture,
  draftFixture,
  draftHref,
  type MotionTransferDraft,
  motionTransferDraftSchema,
  parseDraft,
  sampleCharacterId,
  sampleMotionId,
  snapshotDraft,
  snapshotFixture,
  withCharacter,
  withSeed,
} from "../api.ts";
import { generateInputSchema } from "../contracts.ts";
import { directionFields, generateRequest, shownStep, startingDirection } from "../draft.ts";

/** The draft the wizard gets for `href`: TanStack Router's search parsing, then the route's schema. */
function openedDraft(href: string) {
  const url = new URL(href, "http://localhost");

  assert.equal(url.pathname, "/motionTransfer");

  return motionTransferDraftSchema.parse(defaultParseSearch(url.search));
}

test("parseDraft keeps the members that validate and drops the rest, unknown ones too", () => {
  assert.deepEqual(
    parseDraft({
      // An old link's reshoot angle: the presets are gone, so it is an unknown member.
      angle: "profile",
      character: sampleCharacterId,
      extra: "x",
      from: 42,
      motion: "not-a-uuid",
      prompt: "x".repeat(501),
      seed: -1,
      step: "render",
    }),
    { character: sampleCharacterId },
  );

  assert.deepEqual(
    parseDraft({
      motion: sampleMotionId,
      prompt: "  Neon  ",
      seed: 0,
      step: "motion",
    }),
    { motion: sampleMotionId, prompt: "Neon", seed: 0, step: "motion" },
  );

  assert.deepEqual(parseDraft({ seed: 1.5 }), {});
  assert.deepEqual(parseDraft({ seed: Number.MAX_SAFE_INTEGER + 1 }), {});
  assert.deepEqual(parseDraft({ seed: "random" }), {});
  // The explicit resets: a cleared look (blank or spaces) and the fixed default seed.
  assert.deepEqual(parseDraft({ prompt: "   ", seed: "default" }), { prompt: "", seed: "default" });
  assert.deepEqual(parseDraft("?character=x"), {});
  assert.deepEqual(parseDraft(null), {});
  assert.deepEqual(parseDraft(draftFixture), draftFixture);
});

test("a remix whose look was cleared and seed reset keeps both through snapshot, link and parse, and generates as blank fields", () => {
  const from = "0c7d5e3a-1b2f-4a6c-8d9e-0f1a2b3c4d5e";
  const take = { prompt: "From the take.", seed: "11" };
  const picks = { character: sampleCharacterId, motion: sampleMotionId };

  // The Direct step opened on the take, then the look and the seed were cleared.
  const snapshot = snapshotDraft({
    ...picks,
    from,
    ...directionFields({ ...take, prompt: "", seed: "" }),
  });

  assert.equal(snapshot.prompt, "");
  assert.equal(snapshot.seed, "default");

  const href = draftHref(snapshot);
  const reopened = parseDraft(openedDraft(href));

  assert.deepEqual(reopened, { ...snapshot });
  assert.deepEqual(openedDraft(href), { ...snapshot });

  const start = startingDirection(reopened, take);

  assert.deepEqual(start, { prompt: "", seed: "" });

  // Generated, the resets are parameters left out: the same body as a blank look and seed typed
  // into the form, so the same recipe and hash. (`useGenerate` sends this JSON.)
  const body = (direction: typeof start) =>
    JSON.stringify(generateInputSchema.parse(generateRequest(picks, direction)));

  assert.equal(
    body(start),
    JSON.stringify({
      character_id: sampleCharacterId,
      motion_asset_id: sampleMotionId,
    }),
  );
  assert.equal(body(start), body({ prompt: "  ", seed: "" }));

  // A field left out still starts from the take's.
  assert.deepEqual(startingDirection(parseDraft(openedDraft(draftHref({ from }))), take), take);
});

test("draftHref opens the wizard on the same draft, a look that reads as a number included", () => {
  assert.deepEqual(openedDraft(draftHref(draftFixture)), draftFixture);

  const numeric: MotionTransferDraft = { prompt: "42", seed: 42 };

  assert.deepEqual(openedDraft(draftHref(numeric)), numeric);
  assert.equal(draftHref({}), "/motionTransfer");
  // What does not validate never reaches the link.
  assert.equal(draftHref({ character: "nope", step: "direct" }), "/motionTransfer?step=direct");
});

test('"Animate this character" keeps the motion when there is one, else lands on motion selection', () => {
  const alone = draftHref({ character: sampleCharacterId });

  assert.equal(alone, `/motionTransfer?character=${sampleCharacterId}`);
  assert.deepEqual(openedDraft(alone), { character: sampleCharacterId });
  assert.equal(
    shownStep(openedDraft(alone).step, { character: sampleCharacterId, motion: null }),
    "motion",
  );

  const withMotion = draftHref({ character: sampleCharacterId, motion: sampleMotionId });

  assert.deepEqual(openedDraft(withMotion), {
    character: sampleCharacterId,
    motion: sampleMotionId,
  });
  assert.equal(
    shownStep(openedDraft(withMotion).step, {
      character: sampleCharacterId,
      motion: sampleMotionId,
    }),
    "direct",
  );
});

test("a snapshot is a frozen copy without the step, and withSeed and withCharacter derive new ones", () => {
  const draft: MotionTransferDraft = { ...draftFixture };
  const snapshot = snapshotDraft(draft);

  assert.ok(Object.isFrozen(snapshot));
  assert.equal("step" in snapshot, false);
  draft.seed = 8;
  assert.equal(snapshot.seed, 7);
  assert.throws(() => {
    // @ts-expect-error A snapshot's members are read-only.
    snapshot.seed = 9;
  }, TypeError);

  const reseeded = withSeed(snapshotFixture, 123);

  assert.ok(Object.isFrozen(reseeded));
  assert.notEqual(reseeded, snapshotFixture);
  assert.equal(reseeded.seed, 123);
  assert.equal(snapshotFixture.seed, 7);
  assert.deepEqual({ ...reseeded, seed: snapshotFixture.seed }, { ...snapshotFixture });

  const other = "0c7d5e3a-1b2f-4a6c-8d9e-0f1a2b3c4d5e";
  const recast = withCharacter(snapshotFixture, other);

  assert.ok(Object.isFrozen(recast));
  assert.equal(recast.character, other);
  assert.equal(snapshotFixture.character, sampleCharacterId);

  for (const seed of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => withSeed(snapshotFixture, seed));
  }

  assert.throws(() => withCharacter(snapshotFixture, "not-a-uuid"));
});

test("the Direct step starts from the draft's direction fields over the take's", () => {
  const take = { prompt: "From the take.", seed: "11" };

  assert.deepEqual(startingDirection(draftFixture, take), directionFixture);
  assert.deepEqual(startingDirection({ prompt: "Mine." }, take), { ...take, prompt: "Mine." });
});

test("a draft carried through another page keeps its motion and direction, and comes back with the character picked there", () => {
  const from = "6f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f";
  const picked = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

  // A link to the library or the builder carries the shot in the one member `draft`, without
  // its step and character.
  const search = carryDraft(snapshotDraft({ ...draftFixture, from }));

  const { draft, ...rest } = z
    .object({ draft: z.unknown() })
    .loose()
    .parse(defaultParseSearch(defaultStringifySearch(search)));

  assert.deepEqual(rest, {});

  const carried = carriedDraft(draft);

  assert.ok(carried && Object.isFrozen(carried));
  assert.deepEqual(carried, {
    from,
    motion: sampleMotionId,
    prompt: directionFixture.prompt,
    seed: Number(directionFixture.seed),
  });

  // Back to the wizard with the character picked there: on Direct, motion and direction kept.
  assert.deepEqual(openedDraft(draftHref(withCharacter(carried ?? {}, picked))), {
    character: picked,
    from,
    motion: sampleMotionId,
    prompt: directionFixture.prompt,
    seed: Number(directionFixture.seed),
  });

  // Explicit resets survive the trip too.
  assert.deepEqual(carriedDraft(carryDraft(snapshotDraft({ prompt: "", seed: "default" })).draft), {
    prompt: "",
    seed: "default",
  });

  // A mangled or empty draft carries nothing: the link has no member, the page no draft, and
  // "Animate" lands on motion selection with the character kept.
  assert.equal(carriedDraft({ character: picked, motion: "x", step: "direct" }), undefined);
  assert.equal(carriedDraft("not an object"), undefined);
  assert.deepEqual(carryDraft(undefined), {});
  assert.deepEqual(carryDraft(snapshotDraft({ character: picked })), {});
  assert.deepEqual(openedDraft(draftHref(withCharacter(carriedDraft(undefined) ?? {}, picked))), {
    character: picked,
  });
  assert.equal(shownStep(undefined, { character: picked, motion: null }), "motion");
});
