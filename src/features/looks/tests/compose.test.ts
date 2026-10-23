import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { z } from "zod";

import {
  backgroundBase,
  characterBase,
  type LookCatalog,
  lookCatalog,
  lookGroups,
  type LookOption,
} from "../catalog.ts";
import { composeLook, type Look, pickOption, readLook, removeGroup } from "../compose.ts";

function option(id: string): LookOption {
  const found = lookCatalog.options.find((candidate) => candidate.id === id);

  assert.ok(found, `catalog option ${id}`);

  return found;
}

/** Picks `ids` in order, as clicks on their tiles would. */
function pick(look: Look, ...ids: string[]) {
  return ids.reduce((current, id) => pickOption(current, id).look, look);
}

const neon = option("neon-street");
const beach = option("beach");
const golden = option("golden-hour");
const lowKey = option("low-key");
const glow = option("neon-glow");
const noir = option("noir");

test("the catalog: stable unique ids, one-sentence fragments that never contain one another, conflicts across groups", () => {
  const ids = lookCatalog.options.map(({ id }) => id);

  assert.equal(new Set(ids).size, ids.length);

  for (const { conflicts, fragment, group, id, version } of lookCatalog.options) {
    assert.ok(lookGroups.includes(group));
    assert.ok(Number.isInteger(version) && version >= 1);
    assert.match(fragment, /^[A-Z][^]*\.$/);
    assert.equal(fragment.trim(), fragment);

    for (const other of lookCatalog.options) {
      if (other.id !== id) {
        assert.ok(!other.fragment.includes(fragment), `${other.id} contains ${id}`);
      }
    }

    assert.ok(!characterBase.includes(fragment) && !backgroundBase.includes(fragment));

    for (const conflict of conflicts) {
      const other = option(conflict);

      assert.notEqual(other.group, group, `${id} conflicts within its group`);
      assert.ok(other.conflicts.includes(id), `${conflict} does not name ${id} back`);
    }
  }
});

test("the leading sentences are Motion Transfer's default prompt, and every combination fits in 500 characters", () => {
  // Read, not imported: the default belongs to Motion Transfer; this only pins that a blank
  // description with picks starts from the same words a blank look sends.
  const defaults = z
    .object({ prompt: z.string() })
    .parse(
      JSON.parse(
        readFileSync(
          new URL("../../motionTransfer/workflows/defaults.json", import.meta.url),
          "utf8",
        ),
      ),
    );

  assert.equal(`${characterBase} ${backgroundBase}`, defaults.prompt);

  const longest = Object.fromEntries(
    lookGroups.map((group) => [
      group,
      lookCatalog.options
        .filter((candidate) => candidate.group === group)
        .reduce<LookOption | undefined>(
          (long, candidate) =>
            long && long.fragment.length >= candidate.fragment.length ? long : candidate,
          undefined,
        )?.id,
    ]),
  );

  assert.ok(composeLook({ description: "", selection: longest }).length <= 500);
});

test("without picks the prompt is the description exactly, and a blank one stays blank (the workflow's default)", () => {
  const typed = "  Red  jacket,\n\nwhite sneakers. ";

  assert.equal(composeLook({ description: typed, selection: {} }), typed);
  assert.deepEqual(readLook(typed), { description: typed, selection: {} });
  assert.equal(composeLook({ description: "", selection: {} }), "");
  assert.deepEqual(readLook(""), { description: "", selection: {} });
});

test("picks follow the description in group order, one space apart, and read back exactly", () => {
  const typed = "Red  jacket,\n\nwhite sneakers. ";
  const look = pick({ description: typed, selection: {} }, noir.id, lowKey.id, beach.id);
  const prompt = composeLook(look);

  assert.equal(prompt, `${typed} ${beach.fragment} ${lowKey.fragment} ${noir.fragment}`);
  assert.deepEqual(readLook(prompt), look);

  // The order of the clicks does not matter.
  assert.equal(
    composeLook(pick({ description: typed, selection: {} }, beach.id, lowKey.id, noir.id)),
    prompt,
  );
});

test("with a blank description, picks start from the default's words: the background sentence gives way to a picked background", () => {
  const lit = pick({ description: "", selection: {} }, golden.id);

  assert.equal(composeLook(lit), `${characterBase} ${backgroundBase} ${golden.fragment}`);
  assert.deepEqual(readLook(composeLook(lit)), lit);

  const placed = pick(lit, beach.id);

  assert.equal(composeLook(placed), `${characterBase} ${beach.fragment} ${golden.fragment}`);
  assert.deepEqual(readLook(composeLook(placed)), placed);

  // Removing every pick goes back to blank, not to the leading sentences.
  assert.equal(composeLook(removeGroup(removeGroup(placed, "background"), "lighting")), "");
});

test("toggling never loses the description nor repeats a fragment", () => {
  const typed = "A dancer in a red jacket.";
  let look: Look = { description: typed, selection: {} };

  for (let round = 0; round < 3; round += 1) {
    look = pick(look, neon.id, neon.id, lowKey.id);
    look = removeGroup(look, "background");
    look = pick(look, neon.id);
  }

  const prompt = composeLook(look);

  assert.equal(prompt, `${typed} ${neon.fragment} ${lowKey.fragment}`);
  assert.equal(prompt.split(neon.fragment).length, 2);

  for (const group of lookGroups) {
    look = removeGroup(look, group);
  }

  assert.equal(composeLook(look), typed);
});

test("a fragment typed or pasted into the prompt is a pick, once, however often it appears", () => {
  const pasted = `${neon.fragment} A dancer. ${neon.fragment}\n${lowKey.fragment}`;
  const look = readLook(pasted);

  assert.deepEqual(look, {
    description: "A dancer.\n",
    selection: { background: neon.id, lighting: lowKey.id },
  });
  assert.equal(composeLook(look), `A dancer.\n ${neon.fragment} ${lowKey.fragment}`);
});

test("one option per group: a pick replaces its group's, and conflicting picks give way to the newest", () => {
  const base: Look = { description: "A dancer.", selection: {} };

  assert.deepEqual(pick(base, neon.id, beach.id).selection, { background: beach.id });

  const night = pickOption(pick(base, neon.id, lowKey.id), golden.id);

  assert.deepEqual(night.dropped, [neon]);
  assert.deepEqual(night.look.selection, { lighting: golden.id });

  const back = pickOption(night.look, neon.id);

  assert.deepEqual(back.dropped, [golden]);
  assert.deepEqual(back.look.selection, { background: neon.id });

  const monochrome = pickOption(pick(base, glow.id), noir.id);

  assert.deepEqual(monochrome.dropped, [glow]);
  assert.deepEqual(monochrome.look.selection, { look: noir.id });
  assert.deepEqual(pickOption(monochrome.look, glow.id).look.selection, { lighting: glow.id });

  // An unknown id changes nothing.
  assert.deepEqual(pickOption(base, "no-such-look"), { dropped: [], look: base });
});

test("a catalog change leaves a prompt composed before it as it was: the old fragment reads as the visitor's words", () => {
  const before = composeLook(pick({ description: "A dancer.", selection: {} }, beach.id, noir.id));

  const changed: LookCatalog = {
    options: lookCatalog.options.map((candidate) =>
      candidate.id === beach.id
        ? { ...candidate, fragment: "Background: a tropical beach at noon.", version: 2 }
        : candidate,
    ),
    version: 2,
  };

  const read = readLook(before, changed);

  assert.deepEqual(read, {
    description: `A dancer. ${beach.fragment}`,
    selection: { look: noir.id },
  });
  assert.equal(composeLook(read, changed), before);
});
