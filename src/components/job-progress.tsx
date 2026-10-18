import { useEffect, useState } from "react";

import { Progress } from "#/components/ui/progress";
import { type JobRow, jobEventSchema } from "#/lib/contracts";

export function JobProgress({ job }: { job: JobRow }) {
  const [snapshot, setSnapshot] = useState(job);
  const [disconnected, setDisconnected] = useState(false);
  useEffect(() => {
    if (["complete", "failed", "unknown"].includes(job.status)) {
      return;
    }

    const source = new EventSource(`/api/jobs/${encodeURIComponent(job.id)}/events`);
    source.onopen = () => setDisconnected(false);
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const update = jobEventSchema.parse(JSON.parse(event.data));

        if (update.job.id !== job.id) {
          throw new Error("Wrong render ID");
        }

        setSnapshot(update.job);
        setDisconnected(false);

        if (["complete", "failed", "unknown"].includes(update.job.status)) {
          source.close();
        }
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
      <output aria-live="polite" className="flex justify-between gap-4 text-sm">
        <span>{snapshot.message}</span>
        <span className="font-mono" data-testid="progress-value">
          {snapshot.percent === null ? snapshot.status : `${snapshot.percent}%`}
        </span>
      </output>
      {!failed && <Progress aria-label="Render progress" value={snapshot.percent ?? undefined} />}
      {failed && (
        <p className="text-sm text-destructive" role="alert">
          {snapshot.errorCode}
        </p>
      )}
      {disconnected && !failed && snapshot.status !== "complete" && (
        <p className="text-sm text-muted-foreground">
          Reconnecting to Comfy. Reloading this page recovers the saved render.
        </p>
      )}
      {snapshot.providerJobId && (
        <p className="font-mono text-xs break-all text-muted-foreground">
          Comfy job: {snapshot.providerJobId}
        </p>
      )}
      {snapshot.status === "complete" && (
        <>
          <video
            className="w-full rounded-xl"
            controls
            data-testid="render-video"
            poster={`/media/${snapshot.output.posterFilename}`}
            preload="metadata"
          >
            <source src={`/media/${snapshot.output.filename}`} type="video/mp4" />
            <track kind="captions" />
          </video>
          <p className="text-sm text-muted-foreground">
            {snapshot.output.width} × {snapshot.output.height} ·{" "}
            {snapshot.output.durationSeconds.toFixed(2)} seconds ·{" "}
            {(snapshot.output.bytes / 1_048_576).toFixed(2)} MiB saved
          </p>
          <a
            className="inline-block text-sm underline"
            download
            href={`/media/${snapshot.output.filename}`}
          >
            Download MP4
          </a>
        </>
      )}
    </div>
  );
}
