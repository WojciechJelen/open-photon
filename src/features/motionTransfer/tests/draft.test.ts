import assert from "node:assert/strict";
import test from "node:test";

import { defaultParseSearch } from "@tanstack/react-router";

// Through the public module, as another feature's test would.
import {
  defaultDirection,
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
import { shownStep, startingDirection } from "../draft.ts";

/** The draft the wizard gets for `href`: TanStack Router's search parsing, then the route's schema. */
function openedDraft(href: string) {
  const url = new URL(href, "http://localhost");

  assert.equal(url.pathname, "/motionTransfer");

  return motionTransferDraftSchema.parse(defaultParseSearch(url.search));
}

test("parseDraft keeps the members that validate and drops the rest, unknown ones too", () => {
  assert.deepEqual(
    parseDraft({
      angle: "Front!",
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
      angle: "none",
      motion: sampleMotionId,
      prompt: "  Neon  ",
      seed: 0,
      step: "motion",
    }),
    { angle: "none", motion: sampleMotionId, prompt: "Neon", seed: 0, step: "motion" },
  );

  assert.deepEqual(parseDraft({ prompt: "   ", seed: 1.5 }), {});
  assert.deepEqual(parseDraft({ seed: Number.MAX_SAFE_INTEGER + 1 }), {});
  assert.deepEqual(parseDraft("?character=x"), {});
  assert.deepEqual(parseDraft(null), {});
  assert.deepEqual(parseDraft(draftFixture), draftFixture);
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

test("the Direct step starts from the draft's direction fields over the take's, ignoring an angle not on offer", () => {
  const take = { angle: "profile", prompt: "From the take.", seed: "11" };

  assert.deepEqual(startingDirection(draftFixture, take, ["front", "profile"]), directionFixture);
  assert.deepEqual(startingDirection({ prompt: "Mine." }, take, ["front", "profile"]), {
    ...take,
    prompt: "Mine.",
  });
  assert.deepEqual(
    startingDirection({ angle: "zoom" }, defaultDirection, ["front"]),
    defaultDirection,
  );
  assert.deepEqual(startingDirection({ angle: "none" }, take, ["front", "profile"]), {
    ...take,
    angle: "none",
  });
});
