import { setTimeout as delay } from "node:timers/promises";

import { type GenerationEvent, generationSchema } from "../lib/contracts.ts";
import { comfyProvider, type Provider } from "./comfy.ts";
import { finalize } from "./finalize.ts";
import { settleAbandoned } from "./generate.ts";
import { findGeneration, type Generation, markRunning } from "./generations.ts";

type Update = { generation: Generation; kind: GenerationEvent["kind"] };

// After `provider_unavailable` the browser waits `retry:` before it reconnects: 5 s, doubling on
// each failure in a row (the `Last-Event-ID` it sends back counts them), up to a minute.
const FIRST_RETRY_MS = 5000;
const MAX_RETRY_MS = 60_000;

const diagnostics = {
  active: 0,
  cancellations: 0,
  completed: 0,
  lastGenerationId: "",
  lastReason: "",
  opened: 0,
  requestAborts: 0,
};

export function streamDiagnostics() {
  return { ...diagnostics };
}

function current(id: string) {
  const row = findGeneration(id);

  if (!row) {
    throw new Error(`Generation ${id} not found`);
  }

  return settleAbandoned(row);
}

/**
 * The generation's events: the stored row first, then each change Comfy reports. A row that is
 * `done`, `failed` or `unknown` yields once and never reaches Comfy. When Comfy cannot be asked
 * (unreachable, or an error answer), the last event is `provider_unavailable` with the stored row:
 * the row stays as it is. `signal` ends the Comfy subscription.
 */
async function* generationUpdates(
  id: string,
  signal: AbortSignal,
  provider: Provider,
): AsyncGenerator<Update> {
  signal.throwIfAborted();
  let row = current(id);
  yield { generation: row, kind: "snapshot" };

  // This process is still submitting it: wait until the job id is saved or the submit failed.
  while (row.status === "preparing") {
    await delay(1000, undefined, { signal });
    row = current(id);
    yield { generation: row, kind: "snapshot" };
  }

  if (row.provider_job_id === null || !["queued", "running", "finalizing"].includes(row.status)) {
    return;
  }

  try {
    const job = await provider.job(row.provider_job_id);
    signal.throwIfAborted();

    for await (const event of job.events(signal)) {
      const running =
        event.kind === "progress"
          ? markRunning(id, Math.min(99, Math.max(0, Math.floor(event.value * 100))))
          : event.kind === "statusChange" && event.status === "running"
            ? markRunning(id, null)
            : null;

      if (running) {
        yield { generation: running, kind: "snapshot" };
      }
    }

    // The events end when the job does; `finalize` asks Comfy whether it completed.
    yield { generation: (await finalize(id, provider)) ?? current(id), kind: "snapshot" };
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    console.error(
      JSON.stringify({
        event: "sse.provider-unavailable",
        id,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );

    yield { generation: current(id), kind: "provider_unavailable" };
  }
}

/** The `retry:` delay after `provider_unavailable`, from the failures in a row `Last-Event-ID` counts. */
function retryAfter(request: Request) {
  const failures = Number(
    request.headers.get("Last-Event-ID")?.match(/^provider-unavailable:(\d+)$/)?.[1] ?? 0,
  );

  return { failures: failures + 1, ms: Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** failures) };
}

/** Why an event stream ended. */
type CloseReason = "request-abort" | "consumer-cancel" | "complete" | "error";

/**
 * A server-sent event stream of the events `events` yields (each a whole event, ending in a blank
 * line), with a `: ping` comment every 15 s so proxies keep the connection open, and the headers
 * that keep them from buffering it. A closed request or a cancelled body aborts `events`' signal;
 * `onClose` hears once why the stream ended, with the error message when it failed.
 */
export function eventStream(
  request: Request,
  events: (signal: AbortSignal) => AsyncGenerator<string>,
  onClose?: (reason: CloseReason, message?: string) => void,
) {
  const abort = new AbortController();
  const iterator = events(abort.signal);
  const encoder = new TextEncoder();
  let stopped = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let onAbort: () => void;

  const cleanup = (reason: CloseReason, message?: string) => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(heartbeat);
    request.signal.removeEventListener("abort", onAbort);
    onClose?.(reason, message);
  };

  const body = new ReadableStream<Uint8Array>({
    async cancel() {
      abort.abort();
      cleanup(request.signal.aborted ? "request-abort" : "consumer-cancel");
      await iterator.return(undefined);
    },
    async pull(controller) {
      if (stopped) {
        return;
      }

      try {
        const next = await iterator.next();

        if (stopped) {
          return;
        }

        if (next.done) {
          cleanup("complete");
          controller.close();

          return;
        }

        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        if (!stopped) {
          cleanup("error", error instanceof Error ? error.message : "unknown");
          controller.error(new Error("The event stream failed. Reconnect to recover."));
        }
      }
    },
    start(controller) {
      onAbort = () => {
        abort.abort(request.signal.reason);
        cleanup("request-abort");
        controller.close();
      };

      request.signal.addEventListener("abort", onAbort, { once: true });

      if (request.signal.aborted) {
        onAbort();

        return;
      }

      heartbeat = setInterval(() => {
        if (!stopped) {
          controller.enqueue(encoder.encode(": ping\n\n"));
        }
      }, 15_000);
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * `GET /api/generations/:id/events`: the events as server-sent events (`generationEventSchema`)
 * through `eventStream`. A closed request or cancelled body aborts the Comfy subscription; the
 * job itself continues on Comfy. Each snapshot clears the event id; `provider_unavailable` sets it
 * to `provider-unavailable:<failures in a row>` with a `retry:` delay that doubles with them, then
 * the stream ends cleanly (a 200, never an error) and the browser reconnects after that delay.
 */
export function streamGeneration(request: Request, id: string, provider: Provider = comfyProvider) {
  const retry = retryAfter(request);
  diagnostics.active++;
  diagnostics.opened++;

  return eventStream(
    request,
    async function* (signal) {
      for await (const { generation, kind } of generationUpdates(id, signal, provider)) {
        const fields =
          kind === "provider_unavailable"
            ? `retry: ${retry.ms}\nid: provider-unavailable:${retry.failures}`
            : "id:";

        yield `${fields}\ndata: ${JSON.stringify({ generation: generationSchema.parse(generation), kind })}\n\n`;
      }
    },
    (reason, message) => {
      diagnostics.active--;
      diagnostics.lastReason = reason;
      diagnostics.lastGenerationId = id;

      if (reason === "request-abort") {
        diagnostics.requestAborts++;
      }

      if (reason === "consumer-cancel") {
        diagnostics.cancellations++;
      }

      if (reason === "complete") {
        diagnostics.completed++;
      }

      if (reason === "error") {
        console.error(JSON.stringify({ event: "sse.error", id, message }));
      }

      console.info(JSON.stringify({ active: diagnostics.active, event: "sse.closed", id, reason }));
    },
  );
}
