import { useEffect, useState } from "react";
import { Progress } from "#/components/ui/progress";
import { type JobEvent, jobEventSchema } from "#/lib/contracts";

type StreamState =
	| { kind: "connecting" }
	| JobEvent
	| { kind: "error"; message: string };

export function JobProgress({ jobId }: { jobId: string }) {
	const [state, setState] = useState<StreamState>({ kind: "connecting" });

	useEffect(() => {
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
			source.close();
			setState({
				kind: "error",
				message:
					"The progress stream disconnected. Create a new job to try again.",
			});
		};
		return () => source.close();
	}, [jobId]);

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
