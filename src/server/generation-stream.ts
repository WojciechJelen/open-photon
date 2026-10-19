import { setTimeout as delay } from "node:timers/promises";

import { generationSchema } from "../lib/contracts.ts";
import { comfyProvider, type Provider } from "./comfy.ts";
import { finalize } from "./finalize.ts";
import { settleAbandoned } from "./generate.ts";
import { findGeneration, type Generation, markRunning } from "./generations.ts";

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
 * The generation's snapshots: the stored row first, then each change Comfy reports. A row that
 * is `done`, `failed` or `unknown` yields once and never reaches Comfy. `signal` ends the Comfy
 * subscription.
 */
async function* generationUpdates(
  id: string,
  signal: AbortSignal,
  provider: Provider,
): AsyncGenerator<Generation> {
  signal.throwIfAborted();
  let row = current(id);
  yield row;

  // This process is still submitting it: wait until the job id is saved or the submit failed.
  while (row.status === "preparing") {
    await delay(1000, undefined, { signal });
    row = current(id);
    yield row;
  }

  if (row.provider_job_id === null || !["queued", "running", "finalizing"].includes(row.status)) {
    return;
  }

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
      yield running;
    }
  }

  // The events end when the job does; `finalize` asks Comfy whether it completed.
  yield (await finalize(id, provider)) ?? current(id);
}

/**
 * `GET /api/generations/:id/events`: the snapshots as server-sent events (`generationEventSchema`),
 * with a `: ping` comment every 15 s so proxies keep the connection open. A closed request or
 * cancelled body aborts the Comfy subscription; the job itself continues on Comfy.
 */
export function streamGeneration(request: Request, id: string, provider: Provider = comfyProvider) {
  const abort = new AbortController();
  const iterator = generationUpdates(id, abort.signal, provider);
  const encoder = new TextEncoder();
  let stopped = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let onAbort: () => void;
  diagnostics.active++;
  diagnostics.opened++;

  const cleanup = (reason: "request-abort" | "consumer-cancel" | "complete" | "error") => {
    if (stopped) {
      return;
    }

    stopped = true;
    clearInterval(heartbeat);
    request.signal.removeEventListener("abort", onAbort);
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

    console.info(JSON.stringify({ active: diagnostics.active, event: "sse.closed", id, reason }));
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

        const generation = generationSchema.parse(next.value);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ generation, kind: "snapshot" })}\n\n`),
        );
      } catch (error) {
        if (!stopped) {
          console.error(
            JSON.stringify({
              event: "sse.error",
              id,
              message: error instanceof Error ? error.message : "unknown",
            }),
          );
          cleanup("error");
          controller.error(
            new Error("Comfy progress disconnected. Reconnect to recover the saved generation."),
          );
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
