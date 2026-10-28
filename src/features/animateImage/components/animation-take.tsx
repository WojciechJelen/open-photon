import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { readGeneration, retryAnimation } from "#/features/animateImage/animate-client";
import { GeneratedOutputs } from "#/shared/components/generated-outputs";
import { PublishLink } from "#/shared/components/publish-link";
import type { GenerationOutput, GenerationSnapshot } from "#/shared/contracts";
import type { Refusal } from "#/shared/requests";
import { isFinished, useLiveGeneration } from "#/shared/use-live-generation";

/** What the animation is doing, in words. */
function statusLabel({ position, progress, status }: GenerationSnapshot) {
  switch (status) {
    case "waiting":
      return position ? `Waiting in line: number ${position}` : "Waiting in line";
    case "preparing":
      return "Sending the image to Comfy…";
    case "queued":
      return "Queued on Comfy";
    case "running":
      return progress === null ? "Rendering…" : `Rendering ${progress}%`;
    case "finalizing":
      return "Saving the video…";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "unknown":
      return "Unknown";
  }
}

/**
 * The animation `id` the page follows (`?take=`): read once, then live through its event stream
 * (`useLiveGeneration`), with its progress; once done, the video with its poster, Download, the
 * result page (`/g/:id`) and "Publish & copy link" (an animation stays private until its owner
 * publishes it). A failed or cancelled one offers the shared retry (same source and prompt, a new
 * seed), which opens the attempt it starts (`onRetried`); an unknown one is never retried.
 */
export function AnimationTake({
  id,
  onRefused,
  onRetried,
}: {
  id: string;
  onRefused: (refusal: Refusal, resume: () => void) => void;
  onRetried: (id: string) => void;
}) {
  const [initial, setInitial] = useState<GenerationSnapshot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;

    setProblem(null);

    void readGeneration(id).then((answer) => {
      if (stopped) {
        return;
      }

      if ("data" in answer) {
        setInitial(answer.data);
      } else if (answer.refusal.reason === "access_required") {
        onRefused(answer.refusal, () => setAttempt((count) => count + 1));
      } else {
        setProblem(answer.refusal.message);
      }
    });

    return () => {
      stopped = true;
    };
  }, [id, attempt, onRefused]);

  if (problem) {
    return (
      <p className="text-destructive-foreground" role="alert">
        {problem}
      </p>
    );
  }

  return initial ? (
    <LiveTake initial={initial} key={initial.id} onRefused={onRefused} onRetried={onRetried} />
  ) : (
    <p className="text-muted-foreground" role="status">
      Loading the animation…
    </p>
  );
}

function LiveTake({
  initial,
  onRefused,
  onRetried,
}: {
  initial: GenerationSnapshot;
  onRefused: (refusal: Refusal, resume: () => void) => void;
  onRetried: (id: string) => void;
}) {
  const { generation, providerUnavailable } = useLiveGeneration(initial);
  const { status } = generation;
  const [retrying, setRetrying] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const files = generation.outputs.filter(
    (output): output is GenerationOutput => output.media !== "text",
  );

  const working = !isFinished(status);

  async function retry() {
    setRetrying(true);
    setRefusal(null);

    const answer = await retryAnimation(generation.id);

    setRetrying(false);

    if ("data" in answer) {
      onRetried(answer.data.id);
    } else if (answer.refusal.reason === "access_required") {
      onRefused(answer.refusal, () => void retry());
    } else {
      setRefusal(answer.refusal.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="text-sm font-medium" data-status={status} role="status">
        {statusLabel(generation)}
        {providerUnavailable && " · Comfy is not answering; it keeps trying"}
      </p>
      {working && (
        <>
          <Progress aria-label="Animation progress" value={generation.progress ?? 0} />
          <p className="text-sm text-muted-foreground">
            A 5 s video takes about a minute once it starts. You can leave this page: it keeps
            rendering on the server, and this link shows it when you come back.
          </p>
        </>
      )}
      {status === "done" && (
        <>
          <GeneratedOutputs outputs={files} />
          <div className="flex flex-wrap items-center gap-3">
            <PublishLink generationId={generation.id} media="video" slug={generation.share_slug} />
            <Button asChild variant="ghost">
              <Link params={{ generationId: generation.id }} to="/g/$generationId">
                Result page
                <ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </>
      )}
      {(status === "failed" || status === "cancelled") && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-soft-foreground">
            {generation.error_message ?? "This animation did not finish."}
          </p>
          <Button disabled={retrying} onClick={() => void retry()} variant="outline">
            <RotateCwIcon />
            {retrying ? "Retrying…" : "Retry"}
          </Button>
          {refusal && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {refusal}
            </p>
          )}
        </div>
      )}
      {status === "unknown" && (
        <p className="text-sm text-soft-foreground">
          Comfy may have accepted this animation before its job was saved, so it is never sent again
          on its own. Check the rendering backend before starting it anew.
        </p>
      )}
    </div>
  );
}
