import { useEffect, useState } from "react";
import { Progress } from "#/components/ui/progress";
import { type JobRow, jobEventSchema } from "#/lib/contracts";

export function JobProgress({ job }: { job: JobRow }) {
	const [snapshot, setSnapshot] = useState(job);
	const [disconnected, setDisconnected] = useState(false);
	useEffect(() => {
		if (["complete", "failed", "unknown"].includes(job.status)) return;
		const source = new EventSource(
			`/api/jobs/${encodeURIComponent(job.id)}/events`,
		);
		source.onopen = () => setDisconnected(false);
		source.onmessage = (event: MessageEvent<string>) => {
			try {
				const update = jobEventSchema.parse(JSON.parse(event.data));
				if (update.job.id !== job.id) throw new Error("Wrong render ID");
				setSnapshot(update.job);
				setDisconnected(false);
				if (["complete", "failed", "unknown"].includes(update.job.status))
					source.close();
			} catch {
				source.close();
				setDisconnected(true);
			}
		};
		source.onerror = () => setDisconnected(true);
		return () => source.close();
	}, [job.id, job.status]);
	const failed = snapshot.status === "failed" || snapshot.status === "unknown";
	return (
		<div className="space-y-4">
			<output className="flex justify-between gap-4 text-sm" aria-live="polite">
				<span>{snapshot.message}</span>
				<span className="font-mono" data-testid="progress-value">
					{snapshot.percent === null ? snapshot.status : `${snapshot.percent}%`}
				</span>
			</output>
			{!failed && (
				<Progress
					value={snapshot.percent ?? undefined}
					aria-label="Render progress"
				/>
			)}
			{failed && (
				<p role="alert" className="text-sm text-destructive">
					{snapshot.errorCode}
				</p>
			)}
			{disconnected && !failed && snapshot.status !== "complete" && (
				<p className="text-sm text-muted-foreground">
					Reconnecting to Comfy. Reloading this page recovers the saved render.
				</p>
			)}
			{snapshot.providerJobId && (
				<p className="break-all font-mono text-xs text-muted-foreground">
					Comfy job: {snapshot.providerJobId}
				</p>
			)}
			{snapshot.status === "complete" && (
				<>
					<video
						controls
						preload="metadata"
						poster={`/media/${snapshot.output.posterFilename}`}
						className="w-full rounded-xl"
						data-testid="render-video"
					>
						<source
							src={`/media/${snapshot.output.filename}`}
							type="video/mp4"
						/>
						<track kind="captions" />
					</video>
					<p className="text-sm text-muted-foreground">
						{snapshot.output.width} × {snapshot.output.height} ·{" "}
						{snapshot.output.durationSeconds.toFixed(2)} seconds ·{" "}
						{(snapshot.output.bytes / 1048576).toFixed(2)} MiB saved
					</p>
					<a
						href={`/media/${snapshot.output.filename}`}
						download
						className="inline-block text-sm underline"
					>
						Download MP4
					</a>
				</>
			)}
		</div>
	);
}
