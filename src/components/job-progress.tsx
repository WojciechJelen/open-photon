import { useEffect, useState } from "react";
import { Progress } from "#/components/ui/progress";
import { type JobEvent, type JobRow, jobEventSchema } from "#/lib/contracts";

type StreamState =
	| { kind: "connecting" }
	| JobEvent
	| { kind: "error"; message: string };

export function JobProgress({ job }: { job: JobRow }) {
	const jobId = job.id;
	const [state, setState] = useState<StreamState>(() =>
		job.status === "complete"
			? { kind: "complete", jobId, percent: 100 }
			: { kind: "progress", jobId, percent: job.percent },
	);

	useEffect(() => {
		if (job.status === "complete") return;
		const source = new EventSource(
			`/api/jobs/${encodeURIComponent(jobId)}/events`,
		);
		source.onmessage = (event: MessageEvent<string>) => {
			try {
				const update = jobEventSchema.parse(JSON.parse(event.data));
				if (update.jobId !== jobId)
					throw new Error("Received progress for a different job.");
				setState(update);
				if (update.kind === "complete") source.close();
			} catch {
				source.close();
				setState({
					kind: "error",
					message: "Received an invalid progress event.",
				});
			}
		};
		source.onerror = () => {
			if (source.readyState === EventSource.CLOSED) {
				setState({
					kind: "error",
					message:
						"Progress is unavailable. Reload this page to recover the saved job.",
				});
			}
		};
		return () => source.close();
	}, [jobId, job.status]);

	if (state.kind === "error")
		return (
			<p role="alert" className="text-sm text-destructive">
				{state.message}
			</p>
		);

	const percent = state.kind === "connecting" ? 0 : state.percent;
	const label =
		state.kind === "complete"
			? "Render complete"
			: state.kind === "connecting"
				? "Connecting…"
				: "Rendering…";

	return (
		<div className="space-y-3">
			<output className="flex justify-between text-sm" aria-live="polite">
				<span>{label}</span>
				<span className="font-mono" data-testid="progress-value">
					{percent}%
				</span>
			</output>
			<Progress value={percent} aria-label="Render progress" />
		</div>
	);
}
