import type { JobEvent } from "../lib/contracts.ts";
import { findJob } from "./db.server.ts";

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

export function streamFakeJob(request: Request, jobId: string) {
	const encoder = new TextEncoder();
	let timer: ReturnType<typeof setInterval> | undefined;
	let stopped = false;
	let abort: (() => void) | undefined;
	diagnostics.active++;
	diagnostics.opened++;
	const cleanup = (
		reason: "request-abort" | "consumer-cancel" | "complete" | "error",
	) => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		if (abort) request.signal.removeEventListener("abort", abort);
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
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const finish = (reason: "request-abort" | "complete") => {
				if (stopped) return;
				cleanup(reason);
				controller.close();
			};
			abort = () => finish("request-abort");
			request.signal.addEventListener("abort", abort, { once: true });
			if (request.signal.aborted) {
				finish("request-abort");
				return;
			}
			const tick = () => {
				try {
					const job = findJob(jobId);
					if (!job) throw new Error("Job no longer exists");
					const event: JobEvent =
						job.status === "complete"
							? { kind: "complete", jobId, percent: 100 }
							: { kind: "progress", jobId, percent: job.percent };
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
					);
					if (event.kind === "complete") finish("complete");
				} catch (error) {
					cleanup("error");
					controller.error(error);
				}
			};
			tick();
			if (!stopped) timer = setInterval(tick, 250);
		},
		cancel() {
			cleanup(request.signal.aborted ? "request-abort" : "consumer-cancel");
		},
	});
	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
