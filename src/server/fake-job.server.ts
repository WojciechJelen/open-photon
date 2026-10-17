import type { JobEvent } from "#/lib/contracts";

export function streamFakeJob(request: Request, jobId: string) {
	const encoder = new TextEncoder();
	let timer: ReturnType<typeof setInterval> | undefined;
	let stopped = false;
	let abort: (() => void) | undefined;

	const cleanup = () => {
		stopped = true;
		clearInterval(timer);
		if (abort) request.signal.removeEventListener("abort", abort);
	};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const finish = () => {
				if (stopped) return;
				cleanup();
				controller.close();
			};
			abort = finish;
			request.signal.addEventListener("abort", abort, { once: true });
			if (request.signal.aborted) {
				finish();
				return;
			}
			const send = (event: JobEvent) => {
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
				);
			};
			let percent = 0;
			send({ kind: "progress", jobId, percent });
			timer = setInterval(() => {
				percent += 10;
				if (percent >= 100) {
					send({ kind: "complete", jobId, percent: 100 });
					finish();
					return;
				}
				send({ kind: "progress", jobId, percent });
			}, 300);
		},
		cancel: cleanup,
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
