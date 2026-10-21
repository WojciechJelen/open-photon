import assert from "node:assert/strict";
import test from "node:test";

import { starters, toggleStarter } from "../src/features/motionTransfer/look.ts";

const [neon, studio] = starters.map(({ phrase }) => phrase);

test("a starter chip adds its phrase after the visitor's words, and takes only it out again", () => {
  assert.ok(neon && studio);
  assert.equal(toggleStarter("", neon), neon);
  assert.equal(toggleStarter("A dancer", neon), `A dancer ${neon}`);

  // The visitor's own line breaks and double spaces survive both ways.
  const typed = "Red  jacket,\n\nwhite sneakers.";
  const added = toggleStarter(typed, neon);

  assert.equal(added, `${typed} ${neon}`);
  assert.equal(toggleStarter(added, neon), typed);
  assert.equal(toggleStarter(`${typed}\n`, neon), `${typed}\n${neon}`);
  assert.equal(toggleStarter(`${typed}\n${neon}`, neon), `${typed}\n`);

  // Between other text, a phrase leaves one space where it was.
  const both = toggleStarter(toggleStarter("A dancer", neon), studio);

  assert.equal(toggleStarter(both, neon), `A dancer ${studio}`);
  assert.equal(toggleStarter(toggleStarter("", neon), neon), "");
});
