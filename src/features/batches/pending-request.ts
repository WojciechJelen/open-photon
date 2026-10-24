// The batch request a tab sent for a shot and has not seen a batch for: its variation and request
// key, per shot. It lives in memory for the page's life, mirrored to the tab's `sessionStorage`,
// so asking again after a lost answer, a refusal, a closed dialog or a reload sends the same
// request under the same key (which answers with the batch it admitted, if it did) rather than a
// second batch of fresh seeds. It is forgotten once a batch is admitted. Client-only.
import { z } from "zod";

import { type BatchVariation, batchVariationSchema } from "#/features/batches/contracts";
import type { DraftSnapshot } from "#/features/motionTransfer/api";

const storageKey = "batches:pending";

const pendingSchema = z.record(
  z.string(),
  z.object({ key: z.uuid(), variation: batchVariationSchema }),
);

type PendingRequests = z.output<typeof pendingSchema>;

export type PendingRequest = PendingRequests[string];

let pending: PendingRequests | null = null;

function tabStorage() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// What the tab's storage holds from an earlier page; nothing when it is unreadable or not ours.
function storedRequests(): PendingRequests {
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(tabStorage()?.getItem(storageKey) ?? "null"));

    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function requests(): PendingRequests {
  pending ??= storedRequests();

  return pending;
}

function keep(next: PendingRequests) {
  pending = next;

  try {
    tabStorage()?.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Storage that is disabled or full keeps nothing: the memory still covers this page.
  }
}

const shotKey = (shot: DraftSnapshot) => JSON.stringify(shot);

/** What a variation asks for, comparable whatever order its object's keys came in. */
export function variationKey(variation: BatchVariation) {
  return JSON.stringify(
    variation.kind === "seeds" ? ["seeds", variation.seeds] : ["characters", variation.characters],
  );
}

/** The request this tab sent for `shot` and has no batch for, or `null`. */
export function recallPending(shot: DraftSnapshot): PendingRequest | null {
  return requests()[shotKey(shot)] ?? null;
}

/** Records `variation` of `shot` as sent under `key`, before it is sent. */
export function rememberPending(shot: DraftSnapshot, variation: BatchVariation, key: string) {
  keep({ ...requests(), [shotKey(shot)]: { key, variation } });
}

/** A batch was admitted for `shot`: nothing is pending for it any more. */
export function forgetPending(shot: DraftSnapshot) {
  const next = { ...requests() };

  delete next[shotKey(shot)];
  keep(next);
}
