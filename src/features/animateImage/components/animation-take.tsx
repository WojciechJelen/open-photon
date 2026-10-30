import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ClapperboardIcon,
  DownloadIcon,
  HourglassIcon,
  PlayIcon,
  RotateCwIcon,
  Share2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Progress } from "#/components/ui/progress";
import { readGeneration, retryAnimation } from "#/features/animateImage/animate-client";
import { Viewfinder } from "#/shared/components/brand";
import { shownOutputs } from "#/shared/components/generated-outputs";
import { GENERATED_VIDEO_LABEL } from "#/shared/components/generated-video";
import { PublishLink } from "#/shared/components/publish-link";
import { ResultFigure } from "#/shared/components/result-figure";
import { StableText } from "#/shared/components/stable-text";
import { StateCard } from "#/shared/components/state-card";
import type { Asset, GenerationOutput, GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { isFinished, useLiveGeneration } from "#/shared/use-live-generation";

/** The box every state of a take shows in, so rendering moves nothing. */
export const TAKE_BOX = "aspect-9/16 min-h-0 rounded-field";

/** The corners of the box's viewfinder, low enough that the AI-generated tag covers neither. */
export const VIEWFINDER_CLEAR_OF_TAG = "inset-y-9";

/**
 * How a picture sits in that box: a tall one fills it, and anything wider shows whole, since
 * cropping a still or a clip would hide what the user made.
 */
export function boxFit({ height, width }: Pick<Asset, "height" | "width">) {
  return width && height && width / height > 2 / 3 ? "object-contain" : "object-cover";
}

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

/** The title and sentence of the box while the animation works. */
function workingCopy({ position, progress, status }: GenerationSnapshot) {
  switch (status) {
    case "waiting":
      return {
        text: position
          ? `Number ${position} in line. It starts by itself, so you can leave.`
          : "It starts by itself, so you can leave.",
        title: "In line",
      };
    case "preparing":
      return { text: "Sending the image to Comfy.", title: "Getting ready" };
    case "queued":
      return { text: "Waiting for a free GPU.", title: "Getting ready" };
    case "finalizing":
      return { text: "Saving the video.", title: "Finishing" };
    default:
      return {
        text: "You can leave: this link brings you back.",
        title: progress === null ? "Rendering" : `Rendering ${progress}%`,
      };
  }
}

/** The take's clip: the big Play starts it and hands over to the browser's own controls. */
function ClipPlayer({ asset, poster }: { asset: Asset; poster: Asset | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [played, setPlayed] = useState(false);

  return (
    <>
      <video
        aria-label={GENERATED_VIDEO_LABEL}
        className={cn("absolute inset-0 size-full", boxFit(asset))}
        controls={played}
        onPlay={() => setPlayed(true)}
        playsInline
        poster={poster ? mediaUrl(poster) : undefined}
        preload="metadata"
        ref={video}
        src={mediaUrl(asset)}
      />
      {!played && (
        <>
          <Viewfinder className={VIEWFINDER_CLEAR_OF_TAG} />
          <button
            aria-label="Play"
            className="absolute top-1/2 left-1/2 grid size-15 -translate-1/2 cursor-pointer place-items-center rounded-full bg-background/66 text-foreground transition-colors outline-none hover:bg-background/90 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
            onClick={() => void video.current?.play()}
            type="button"
          >
            <PlayIcon aria-hidden="true" className="size-5" />
          </button>
        </>
      )}
    </>
  );
}

/**
 * The share button of a done take. Publishing stays the owner's explicit step after checking the
 * result, so it opens `PublishLink`, which says what publishing does and holds the link after.
 */
function ShareDialog({ generation }: { generation: GenerationSnapshot }) {
  const [slug, setSlug] = useState(generation.share_slug);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label="Publish and copy a share link" size="icon" variant="outline">
          <Share2Icon aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} size="sm">
        <DialogHeader>
          <DialogTitle>Share this animation</DialogTitle>
        </DialogHeader>
        <PublishLink generationId={generation.id} media="video" onPublished={setSlug} slug={slug} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The box and what sits under it, whatever the take is doing: `animate` and the take's Download and
 * share (quiet until there is a `done` take with its `file`), then `note`, beside the link to the
 * result page once there is one.
 */
function TakeFrame({
  animate,
  children,
  done,
  note,
}: {
  animate: ReactNode;
  children: ReactNode;
  done?: { file: Asset; generation: GenerationSnapshot };
  note: ReactNode;
}) {
  return (
    <>
      {children}
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 flex-col">{animate}</div>
        {done ? (
          <>
            <Button aria-label="Download video" asChild size="icon" variant="outline">
              <a download href={`${mediaUrl(done.file)}?download=1`}>
                <DownloadIcon aria-hidden="true" />
              </a>
            </Button>
            <ShareDialog generation={done.generation} />
          </>
        ) : (
          <>
            <Button aria-label="Download video" disabled size="icon" variant="outline">
              <DownloadIcon aria-hidden="true" />
            </Button>
            <Button
              aria-label="Publish and copy a share link"
              disabled
              size="icon"
              variant="outline"
            >
              <Share2Icon aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
      <div className="flex min-h-11 min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">{note}</div>
        {done && (
          <div className="max-w-1/2 shrink-0">
            <Button asChild size="inline" variant="link">
              <Link params={{ generationId: done.generation.id }} to="/g/$generationId">
                <span>Result page</span>
              </Link>
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The animation the page follows (`?take=`): read once, then live through its event stream
 * (`useLiveGeneration`), with its progress; once done, the video with its poster, Download, the
 * result page (`/g/:id`) and "Publish & copy link" (an animation stays private until its owner
 * publishes it). A failed or cancelled one offers the shared retry (same source and prompt, a new
 * seed), which opens the attempt it starts (`onRetried`); an unknown one is never retried. With no
 * `id` the box shows `idle`. `still`, when known, is the backdrop while it renders.
 */
export function AnimationTake({
  animate,
  id,
  idle,
  note,
  onRefused,
  onRetried,
  still,
}: {
  animate: ReactNode;
  id?: string;
  idle: ReactNode;
  note: ReactNode;
  onRefused: (refusal: Refusal, resume: () => void) => void;
  onRetried: (id: string) => void;
  still?: string;
}) {
  const [initial, setInitial] = useState<GenerationSnapshot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) {
      return;
    }

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

  if (!id) {
    return (
      <TakeFrame animate={animate} note={note}>
        {idle}
      </TakeFrame>
    );
  }

  if (problem) {
    return (
      <TakeFrame animate={animate} note={note}>
        <div role="alert">
          <StateCard
            backdrop={still}
            className={TAKE_BOX}
            icon={TriangleAlertIcon}
            text={problem}
            title="This take didn't load"
            tone="warning"
          />
        </div>
      </TakeFrame>
    );
  }

  return initial ? (
    <LiveTake
      animate={animate}
      initial={initial}
      key={initial.id}
      note={note}
      onRefused={onRefused}
      onRetried={onRetried}
      still={still}
    />
  ) : (
    <TakeFrame animate={animate} note={note}>
      <div role="status">
        <StateCard
          backdrop={still}
          className={TAKE_BOX}
          frame={!still}
          title="Loading the animation…"
        />
      </div>
    </TakeFrame>
  );
}

function LiveTake({
  animate,
  initial,
  note,
  onRefused,
  onRetried,
  still,
}: {
  animate: ReactNode;
  initial: GenerationSnapshot;
  note: ReactNode;
  onRefused: (refusal: Refusal, resume: () => void) => void;
  onRetried: (id: string) => void;
  still?: string;
}) {
  const { generation, providerUnavailable } = useLiveGeneration(initial);
  const { status } = generation;
  const [retrying, setRetrying] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const files = generation.outputs.filter(
    (output): output is GenerationOutput => output.media !== "text",
  );

  const clip = status === "done" ? shownOutputs(files).videos[0] : undefined;

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

  function box() {
    if (clip) {
      return (
        <ResultFigure aspect="aspect-9/16">
          <ClipPlayer asset={clip.video.asset} poster={clip.poster?.asset ?? null} />
        </ResultFigure>
      );
    }

    if (status === "failed" || status === "cancelled") {
      const reason = refusal ?? generation.error_message ?? "Try again, or change the shot.";

      return (
        <div role={refusal ? "alert" : undefined}>
          <StateCard
            backdrop={still}
            className={TAKE_BOX}
            icon={TriangleAlertIcon}
            text={
              <span className="line-clamp-5" title={reason}>
                {reason}
              </span>
            }
            title="This take didn't finish"
            tone="warning"
          >
            <Button disabled={retrying} onClick={() => void retry()}>
              <RotateCwIcon aria-hidden="true" />
              <StableText
                current={retrying ? "Retrying…" : "Try again"}
                labels={["Try again", "Retrying…"]}
              />
            </Button>
          </StateCard>
        </div>
      );
    }

    if (status === "unknown") {
      return (
        <StateCard
          backdrop={still}
          className={TAKE_BOX}
          icon={HourglassIcon}
          text="Comfy may have accepted this animation before its job was saved, so it is never sent again on its own. Check the rendering backend before starting it anew."
          title="Not sure yet"
          tone="quiet"
        />
      );
    }

    if (isFinished(status)) {
      return (
        <StateCard
          backdrop={still}
          className={TAKE_BOX}
          icon={TriangleAlertIcon}
          text="It finished without a video."
          title="This take didn't finish"
          tone="warning"
        />
      );
    }

    const { text, title } = workingCopy(generation);

    return (
      <StateCard
        backdrop={still}
        className={TAKE_BOX}
        icon={status === "waiting" ? HourglassIcon : ClapperboardIcon}
        text={providerUnavailable ? "Comfy is not answering; it keeps trying." : text}
        title={title}
        tone="quiet"
      >
        <div className="w-50 max-w-full">
          <Progress aria-label="Animation progress" value={generation.progress ?? 0} />
        </div>
      </StateCard>
    );
  }

  return (
    <TakeFrame
      animate={animate}
      done={clip ? { file: clip.video.asset, generation } : undefined}
      note={note}
    >
      <p aria-live="polite" className="sr-only" data-status={status} role="status">
        {statusLabel(generation)}
        {providerUnavailable && " · Comfy is not answering; it keeps trying"}
      </p>
      {box()}
    </TakeFrame>
  );
}
