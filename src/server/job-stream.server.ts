import { jobUpdates } from "./render-job.server.ts";

const diagnostics = {
	active: 0,
	opened: 0,
	requestAborts: 0,
	cancellations: 0,
	completed: 0,
	lastReason: "",
	lastJobId: "",
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
	const cleanup = (
		reason: "request-abort" | "consumer-cancel" | "complete" | "error",
	) => {
		if (stopped) return;
		stopped = true;
		clearInterval(heartbeat);
		request.signal.removeEventListener("abort", onAbort);
		diagnostics.active--;
		diagnostics.lastReason = reason;
		diagnostics.lastJobId = jobId;
		if (reason === "request-abort") diagnostics.requestAborts++;
		if (reason === "consumer-cancel") diagnostics.cancellations++;
		if (reason === "complete") diagnostics.completed++;
		console.info(
			JSON.stringify({
				event: "sse.closed",
				jobId,
				reason,
				active: diagnostics.active,
			}),
		);
	};
	const body = new ReadableStream<Uint8Array>({
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
				if (!stopped) controller.enqueue(encoder.encode(": keep-alive\n\n"));
			}, 15000);
		},
		async pull(controller) {
			if (stopped) return;
			try {
				const next = await iterator.next();
				if (stopped) return;
				if (next.done) {
					cleanup("complete");
					controller.close();
					return;
				}
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({ kind: "snapshot", job: next.value })}\n\n`,
					),
				);
			} catch {
				if (!stopped) {
					cleanup("error");
					controller.error(
						new Error(
							"Comfy progress disconnected. Reconnect to recover the saved render.",
						),
					);
				}
			}
		},
		async cancel() {
			abort.abort();
			cleanup(request.signal.aborted ? "request-abort" : "consumer-cancel");
			await iterator.return(undefined);
		},
	});
	return new Response(body, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
