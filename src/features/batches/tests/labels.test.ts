import assert from "node:assert/strict";
import test from "node:test";

import { dayAndTime } from "../../../shared/when.ts";
import { batchTitle } from "../labels.ts";

test("a batch is titled by what it varies", () => {
  assert.equal(batchTitle("seeds", 4), "4 seeds, one shot");
  assert.equal(batchTitle("characters", 3), "3 characters, one shot");
});

test("a batch's time reads by the calendar day, not the hours since", () => {
  const now = new Date(2026, 9, 30, 0, 30);

  const at = (...parts: [number, number, number, number, number]) =>
    dayAndTime(new Date(...parts).toISOString(), now);

  assert.match(at(2026, 9, 30, 0, 5), /^Today at /);
  // Less than an hour ago, and yesterday all the same.
  assert.match(at(2026, 9, 29, 23, 50), /^Yesterday at /);
  assert.match(at(2026, 9, 29, 0, 5), /^Yesterday at /);
  assert.doesNotMatch(at(2026, 9, 28, 23, 50), /^(Today|Yesterday) at |2026/);
  assert.match(at(2025, 9, 28, 12, 0), /2025/);
});
