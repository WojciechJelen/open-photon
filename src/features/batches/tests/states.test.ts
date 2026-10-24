import assert from "node:assert/strict";
import test from "node:test";

import { batchProgress, itemState } from "../progress.ts";

test("every generation status reads as one of the five item states", () => {
  assert.deepEqual(
    (
      [
        "waiting",
        "preparing",
        "queued",
        "running",
        "finalizing",
        "done",
        "failed",
        "unknown",
        "cancelled",
      ] as const
    ).map(itemState),
    [
      "waiting",
      "running",
      "running",
      "running",
      "running",
      "completed",
      "failed",
      "unknown",
      "failed",
    ],
  );
});

test("a batch's progress counts finished items whole and running ones by their progress", () => {
  assert.deepEqual(
    batchProgress([
      { progress: null, status: "done" },
      { progress: 50, status: "running" },
      { progress: null, status: "waiting" },
      { progress: null, status: "unknown" },
    ]),
    {
      counts: { completed: 1, failed: 0, running: 1, unknown: 1, waiting: 1 },
      finished: 2,
      percent: 63,
      total: 4,
    },
  );
});
