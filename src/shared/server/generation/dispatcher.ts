/**
 * The dispatcher: one per server process (`src/app/boot.ts` starts it after seeding, and stops it
 * when the server closes), so generations progress with no browser connected and after a
 * restart.
 *
 * - **Admission.** A request admits a new generation at once (`preparing`, submitted inside the
 *   request) while a place in flight is free (`IN_FLIGHT_MAX` bounds `preparing..finalizing`) and
 *   nobody waits in line; otherwise it stores it `waiting` and answers 202 with its place in line
 *   (`submit`, `submitMany` in `service.ts`). A `waiting` row has no provider job and holds its
 *   access code's count.
 * - **Claims.** On each wake (a row joined the line or changed status, `onQueueChange`) and every
 *   `GENERATION_DISPATCH_MS` (default 3000), while fewer than `IN_FLIGHT_MAX` generations are in
 *   flight on the endpoint this server renders on, it takes the oldest `waiting` row for that
 *   endpoint (`claimNextWaiting`: one `BEGIN IMMEDIATE` transaction, `waiting → preparing`,
 *   `claimed_at`, `claimed_by` = this process) and submits it as a request would (`sendClaimed`:
 *   upload, build, submit, `markQueued`).
 * - **Progress.** Every `GENERATION_DISPATCH_MS` it asks the provider about each `queued`,
 *   `running` or `finalizing` row (`finalize`, with its backoff after a failed download), so a
 *   finished job is collected and its place freed whether or not anyone watches its event stream,
 *   which stays a view over the row. One finalize per row at a time; a row whose poll fails
 *   (the provider unreachable) is asked again after a capped, jittered exponential backoff, which
 *   counts no download attempt and refunds nothing.
 *
 * Restart recovery (`recoverAfterRestart`, run once at boot before the dispatcher starts; one
 * process runs per installation, so every claim found then is a stopped process's):
 *
 * - `waiting`: stays in line, in its place (`created_at`), and the dispatcher submits it. One
 *   whose recipe was resolved for another endpoint than the one this server renders on now
 *   (`target`, `target_origin`) can never be submitted here: it is `cancelled`
 *   (`target_mismatch`), which gives its access code's count back.
 * - `preparing` with no `submit_started_at`: the graph never reached the provider, so it goes back
 *   to `waiting` (`releaseClaim`: unclaimed, its place and count kept) and is submitted again,
 *   under the same idempotency key.
 * - `preparing` with `submit_started_at`: the provider may have the job, so it becomes `unknown`
 *   and is never resubmitted; its count is not given back.
 * - `queued`, `running`: left as they are, for the dispatcher's first poll to ask the provider
 *   about (`finalize`); one submitted to another endpoint than this server's fails
 *   `target_mismatch` without a provider call (`failElsewhere`), and is not refunded.
 * - `finalizing`: resumed by that poll, which downloads the outputs again with the attempt counter
 *   it had (`finalize_attempts`; the third failure fails it `finalize_failed`).
 * - `done`, `failed`, `unknown`, `cancelled`: final, untouched.
 */
import { comfyProvider, type Provider } from "../comfy-provider.ts";
import { inFlightMax } from "../limits.ts";
import { finalize } from "./finalize.ts";
import {
  cancelWaiting,
  claimNextWaiting,
  findFollowable,
  findGeneration,
  findPreparing,
  findWaitingElsewhere,
  onQueueChange,
} from "./generations.ts";
import { sendClaimed, settleAbandoned, targetOf } from "./service.ts";

/** `GENERATION_DISPATCH_MS`: how often the dispatcher polls, default 3 s. */
function dispatchInterval() {
  const configured = Number(process.env.GENERATION_DISPATCH_MS ?? 3000);

  return Number.isInteger(configured) && configured > 0 ? configured : 3000;
}

// The longest a row whose polls keep failing waits before it is asked again.
const MAX_POLL_BACKOFF_MS = 60_000;

/** Logs a failed pass, submit or finalize; the row keeps its state, and the next pass retries. */
function logError(event: string, id: string | null, error: Error | string) {
  console.error(
    JSON.stringify({ event, id, message: error instanceof Error ? error.message : error }),
  );
}

/**
 * Settles what a stopped process left (the cases at the top of this file) before the dispatcher
 * starts, and returns what it did, by row id.
 */
export function recoverAfterRestart(provider: Provider = comfyProvider) {
  const released: string[] = [];
  const unknown: string[] = [];
  const cancelled: string[] = [];
  const target = targetOf(provider);

  for (const id of findPreparing()) {
    const row = findGeneration(id);

    if (row) {
      (settleAbandoned(row).status === "waiting" ? released : unknown).push(id);
    }
  }

  for (const id of findWaitingElsewhere(target)) {
    const row = findGeneration(id);

    cancelWaiting(id, {
      error_code: "target_mismatch",
      error_message: `This generation was waiting to be sent to ${row?.target_origin ?? row?.target}, not to the endpoint this server renders on now (${target.origin ?? target.kind}), so it was cancelled before anything was sent; its generation was given back. A retry renders it here.`,
    });
    cancelled.push(id);
  }

  console.info(JSON.stringify({ cancelled, event: "generation.recovered", released, unknown }));

  return { cancelled, released, unknown };
}

export type Dispatcher = {
  /** Stops waking and polling, then waits for every submit and finalize it started. */
  stop(): Promise<void>;
};

/**
 * Starts a dispatcher (the behavior at the top of this file) for `provider`, polling every
 * `intervalMs`. Its timers never keep the process alive on their own.
 */
export function startDispatcher({
  intervalMs = dispatchInterval(),
  provider = comfyProvider,
}: { intervalMs?: number; provider?: Provider } = {}): Dispatcher {
  const work = new Set<Promise<unknown>>();
  // The rows a finalize started by this dispatcher is still asking about.
  const asking = new Set<string>();
  // The rows whose last poll failed (the provider unreachable, a download that failed): how many
  // times in a row, and when they may be asked again.
  const failing = new Map<string, { failures: number; until: number }>();
  let stopped = false;
  let scheduled: NodeJS.Immediate | null = null;
  let poll = false;

  const track = (promise: Promise<unknown>) => {
    work.add(promise);
    void promise.finally(() => work.delete(promise));
  };

  /**
   * Asks the provider about one row (`finalize`), unless a finalize of it is still running or its
   * backoff has not passed. A failure waits `intervalMs` doubled for each failure in a row, up
   * to `MAX_POLL_BACKOFF_MS`, less up to half at random so rows do not ask in step; a poll that
   * succeeds resets it. Nothing here touches the row: a failed provider call is no download
   * attempt (`finalize_attempts`) and refunds nothing.
   */
  const follow = (id: string, now: number) => {
    if (asking.has(id) || (failing.get(id)?.until ?? 0) > now) {
      return;
    }

    asking.add(id);
    track(
      finalize(id, provider)
        .then(
          () => failing.delete(id),
          (error) => {
            const failures = (failing.get(id)?.failures ?? 0) + 1;
            const wait = Math.min(MAX_POLL_BACKOFF_MS, intervalMs * 2 ** (failures - 1));

            failing.set(id, { failures, until: Date.now() + wait * (0.5 + Math.random() / 2) });
            logError("dispatch.finalize-error", id, error);
          },
        )
        .finally(() => asking.delete(id)),
    );
  };

  /**
   * One pass, synchronous up to the provider calls it starts, so passes never overlap: claims
   * every row a free place admits, then (on a poll) asks about every job in flight.
   */
  const run = () => {
    const polling = poll;
    const target = targetOf(provider);
    const max = inFlightMax();

    scheduled = null;
    poll = false;

    for (let row = claimNextWaiting(target, max); row; row = claimNextWaiting(target, max)) {
      const { id } = row;

      track(
        sendClaimed(row, provider).catch((error) => logError("dispatch.submit-error", id, error)),
      );
    }

    if (polling) {
      const now = Date.now();
      const followable = findFollowable();

      for (const id of failing.keys()) {
        if (!followable.includes(id)) {
          failing.delete(id);
        }
      }

      for (const id of followable) {
        follow(id, now);
      }
    }
  };

  /** Runs a pass soon, once however often it is asked for; `polling` asks it to poll too. */
  const schedule = (polling: boolean) => {
    poll ||= polling;

    if (stopped || scheduled) {
      return;
    }

    scheduled = setImmediate(() => {
      try {
        run();
      } catch (error) {
        scheduled = null;
        logError("dispatch.error", null, error instanceof Error ? error : "unknown");
      }
    });
    scheduled.unref();
  };

  const interval = setInterval(() => schedule(true), intervalMs);

  interval.unref();

  const unsubscribe = onQueueChange(() => schedule(false));

  // The line as a restart left it: claim at once, and ask about every job in flight.
  schedule(true);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(interval);
      unsubscribe();

      if (scheduled) {
        clearImmediate(scheduled);
        scheduled = null;
      }

      while (work.size > 0) {
        await Promise.allSettled(work);
      }
    },
  };
}
