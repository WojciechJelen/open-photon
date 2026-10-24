// How the batch page reads its items' generations: each item's state in the five words the page
// uses, and the batch's aggregate progress. Pure, client-safe and loadable by Node.
import type { GenerationSnapshot } from "../../shared/contracts.ts";

/**
 * An item's state: `waiting` in line (nothing sent to Comfy), `running` from its claim until its
 * outputs are stored, `completed` with its outputs, `failed` (failed, or cancelled before it was
 * sent; the shared retry can render it anew) or `unknown` (Comfy may have it; never resubmitted).
 */
export type ItemState = "completed" | "failed" | "running" | "unknown" | "waiting";

const stateOf: Record<GenerationSnapshot["status"], ItemState> = {
  cancelled: "failed",
  done: "completed",
  failed: "failed",
  finalizing: "running",
  preparing: "running",
  queued: "running",
  running: "running",
  unknown: "unknown",
  waiting: "waiting",
};

export function itemState(status: GenerationSnapshot["status"]) {
  return stateOf[status];
}

/**
 * The batch's progress: how many items are in each state, how many have finished (completed,
 * failed or unknown: nothing more happens to them on its own), and the whole batch's percent,
 * each finished item counting 100 and a running one its reported progress.
 */
export function batchProgress(
  generations: ReadonlyArray<Pick<GenerationSnapshot, "progress" | "status">>,
) {
  const counts: Record<ItemState, number> = {
    completed: 0,
    failed: 0,
    running: 0,
    unknown: 0,
    waiting: 0,
  };

  let points = 0;

  for (const { progress, status } of generations) {
    const state = itemState(status);

    counts[state] += 1;
    points += state === "running" ? (progress ?? 0) : state === "waiting" ? 0 : 100;
  }

  const finished = counts.completed + counts.failed + counts.unknown;

  return {
    counts,
    finished,
    percent: generations.length === 0 ? 0 : Math.round(points / generations.length),
    total: generations.length,
  };
}
