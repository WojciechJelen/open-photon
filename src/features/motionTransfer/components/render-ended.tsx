import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import { RenderTrack } from "#/features/motionTransfer/components/render-progress";
import type { MotionTransferDraft } from "#/features/motionTransfer/draft";
import { Panel } from "#/shared/components/panel";
import { StableText } from "#/shared/components/stable-text";
import { StateCard } from "#/shared/components/state-card";
import type { GenerationSnapshot } from "#/shared/contracts";

type ErrorCode = NonNullable<GenerationSnapshot["error_code"]>;

/**
 * Each failure in plain words, from its `error_code` (`generationErrorCodeSchema`), and which
 * action leads: a new seed where the render itself failed, a change of shot where Comfy refused
 * the inputs.
 */
const failures: Record<ErrorCode, { lead: "change" | "retry"; text: string; title: string }> = {
  finalize_failed: {
    lead: "retry",
    text: "Comfy finished the render, but the app could not download or store the video after three tries. The job and its output stay in the Comfy account's history. A retry renders it again.",
    title: "The video couldn't be saved",
  },
  target_mismatch: {
    lead: "retry",
    text: "This take was sent to another rendering endpoint than the one this server uses now, so it can't be followed from here. A retry renders it again on the current one.",
    title: "This take ran somewhere else",
  },
  interrupted: {
    lead: "retry",
    text: "The server stopped before it sent this take to Comfy, so nothing was rendered. Try again; your motion, character and direction are all still picked.",
    title: "This take never started",
  },
  provider_failed: {
    lead: "retry",
    text: "Comfy stopped the job partway through, or it ended without a video. Try again with a new seed; your motion, character and direction are all still picked.",
    title: "This take didn't finish",
  },
  provider_rejected: {
    lead: "change",
    text: "Comfy refused the clip, the photo or the job, so nothing rendered. A new seed is unlikely to help: try another clip or photo.",
    title: "Comfy turned this take down",
  },
  provider_unreachable: {
    lead: "retry",
    text: "The connection to Comfy failed, so the job never reached it. Try again in a moment.",
    title: "Comfy couldn't be reached",
  },
  timeout: {
    lead: "retry",
    text: "A request to Comfy ran out of time, or the job expired there. Try again in a moment.",
    title: "Comfy took too long",
  },
  unknown: {
    lead: "retry",
    text: "Something unexpected stopped this take. Try again with a new seed, or change the shot.",
    title: "This take failed",
  },
};

/** A take cancelled while it waited in line: nothing was sent, so nothing was charged. */
const cancelledEnding = {
  lead: "retry",
  text: "This take was cancelled while it waited for a rendering slot, so nothing was rendered or charged. Retry it, or change the shot; your motion, character and direction are all still picked.",
  title: "This take was cancelled",
} as const;

/** How a take that is not a video ended, in plain words (`failures`, `cancelledEnding`). */
function endingOf(generation: GenerationSnapshot) {
  return generation.status === "cancelled"
    ? cancelledEnding
    : failures[generation.error_code ?? "unknown"];
}

/** What a child action (a retry or a re-run) is doing, as `GenerationView` tracks it. */
export type ChildState =
  | { state: "idle" | "reused" }
  | { action: "rerun" | "retry"; state: "needs-code" | "running" }
  | { action: "rerun" | "retry"; message: string; state: "refused" };

/** Whether `action` is what the page is waiting for. */
function isRunning(child: ChildState, action: "rerun" | "retry") {
  return child.state === "running" && child.action === action;
}

/**
 * The stage of a take that ended without a video, the page's heading: what happened and the way
 * on. `failed` (or `cancelled` in line): Try again with a new seed (`POST …/retry`), or change the
 * shot (the wizard with the same picks). `unknown`: Comfy may still be rendering it, so it is never
 * sent again; only a new take is offered. `className` fits it to the stage.
 */
export function RenderEndedCard({
  backdrop,
  child,
  className,
  generation,
  onChild,
  shot,
}: {
  backdrop?: string;
  child: ChildState;
  className?: string;
  generation: GenerationSnapshot;
  onChild: (action: "rerun" | "retry") => void;
  shot: MotionTransferDraft;
}) {
  const unknown = generation.status === "unknown";
  const { lead } = endingOf(generation);
  const changeLeads = unknown || lead === "change";

  const changeShot = (
    <Button asChild variant={changeLeads ? "default" : "outline"}>
      <Link search={{ ...shot, step: "direct" }} to="/motionTransfer">
        Edit the shot
      </Link>
    </Button>
  );

  return (
    <StateCard
      backdrop={backdrop}
      className={className}
      heading="h1"
      icon={TriangleAlertIcon}
      text={
        unknown
          ? "Start a new take: your picks are kept."
          : changeLeads
            ? "Change the shot, or try again."
            : "Try again, or change the shot."
      }
      title={endingTitle(generation)}
      tone="warning"
    >
      {changeLeads && changeShot}
      {unknown ? (
        <Button asChild variant="outline">
          <Link search={{}} to="/motionTransfer">
            New shot
          </Link>
        </Button>
      ) : (
        <Button
          disabled={child.state === "running"}
          onClick={() => onChild("retry")}
          variant={changeLeads ? "outline" : "default"}
        >
          <RotateCwIcon aria-hidden="true" />
          <StableText
            current={isRunning(child, "retry") ? "Retrying…" : "Try again"}
            labels={["Try again", "Retrying…"]}
          />
        </Button>
      )}
      {!changeLeads && changeShot}
    </StateCard>
  );
}

/**
 * Beside `RenderEndedCard`: the bar where it stopped, then why in plain words with the stored
 * message and code as the alert, and Re-run the same recipe (`POST …/rerun`), which an `unknown`
 * take does not offer. `note` says what this take is a retry of.
 */
export function RenderEndedDetail({
  child,
  generation,
  note,
  onChild,
  seed,
}: {
  child: ChildState;
  generation: GenerationSnapshot;
  note?: ReactNode;
  onChild: (action: "rerun" | "retry") => void;
  seed: number;
}) {
  const unknown = generation.status === "unknown";
  const { progress } = generation;
  const refused = child.state === "refused" ? child.message : null;

  return (
    <>
      <RenderTrack generation={generation} />
      <Panel className="flex-row items-start gap-3 p-5" role="alert">
        <CircleAlertIcon
          aria-hidden="true"
          className="mt-0.5 size-4.5 shrink-0 text-warning"
          strokeWidth={1.75}
        />
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-pretty wrap-anywhere text-soft-foreground">
            {unknown
              ? "Comfy may still be rendering this one, so it isn't sent again. Start a new take instead: your picks are kept."
              : endingOf(generation).text}
          </p>
          {generation.error_message && (
            <p className="line-clamp-5 text-sm wrap-anywhere" title={generation.error_message}>
              {generation.error_message}
            </p>
          )}
          <span className="font-mono text-xs break-all text-muted-foreground">
            {generation.error_code ?? generation.status} · seed {seed}
            {progress ? ` · stopped at ${progress}%` : ""}
          </span>
        </div>
      </Panel>
      {!unknown && (
        <div className="flex flex-wrap items-center gap-x-4">
          <Button
            disabled={child.state === "running"}
            onClick={() => onChild("rerun")}
            size="inline"
            variant="link"
          >
            <StableText
              current={isRunning(child, "rerun") ? "Re-running…" : "Re-run recipe"}
              labels={["Re-run recipe", "Re-running…"]}
            />
          </Button>
          {refused && (
            <p className="min-w-0 type-caption text-destructive-foreground" role="alert">
              {refused}
            </p>
          )}
        </div>
      )}
      {note && <p className="type-caption text-muted-foreground">{note}</p>}
    </>
  );
}

/** The heading of an ending that is not a video; `noun` is what the page calls its result. */
export function endingTitle(generation: GenerationSnapshot, noun: "image" | "take" = "take") {
  const title =
    generation.status === "unknown" ? "This take's status is unknown" : endingOf(generation).title;

  return title.replace("take", noun);
}
