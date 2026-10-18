import { jobUpdates } from "./render-job.server.ts";

const diagnostics = {
  active: 0,
  cancellations: 0,
  completed: 0,
  lastJobId: "",
  lastReason: "",
  opened: 0,
  requestAborts: 0,
};

export function streamDiagnostics() {
  return { ...diagnostics };
}

export function streamJob(request: Request, jobId: string) {
  const abort = new AbortController();
  const iterator = jobUpdates(jobId, abort.signal);
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
    diagnostics.lastJobId = jobId;

    if (reason === "request-abort") {
      diagnostics.requestAborts++;
    }

    if (reason === "consumer-cancel") {
      diagnostics.cancellations++;
    }

    if (reason === "complete") {
      diagnostics.completed++;
    }

    console.info(
      JSON.stringify({
        active: diagnostics.active,
        event: "sse.closed",
        jobId,
        reason,
      }),
    );
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

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ job: next.value, kind: "snapshot" })}\n\n`),
        );
      } catch {
        if (!stopped) {
          cleanup("error");
          controller.error(
            new Error("Comfy progress disconnected. Reconnect to recover the saved render."),
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
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
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
