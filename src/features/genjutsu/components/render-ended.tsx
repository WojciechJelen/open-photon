import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, RotateCwIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type { GenerationSnapshot } from "#/features/genjutsu/contracts";
import type { WizardSearch } from "#/features/genjutsu/wizard";

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

/** What a child action (a retry or a re-run) is doing, as `GenerationView` tracks it. */
export type ChildState =
  | { state: "idle" | "reused" }
  | { action: "rerun" | "retry"; state: "needs-code" | "running" }
  | { action: "rerun" | "retry"; message: string; state: "refused" };

/**
 * The endings that are not a video. `failed`: the reason in plain words, the stored message and
 * code as the alert, and what the API can do about it: Retry with a new seed
 * (`POST …/retry`), Re-run the same recipe (`POST …/rerun`), or change the shot (the wizard with
 * the same picks). `unknown`: Comfy may still be rendering it, so it is never sent again; only a
 * new take is offered.
 */
export function RenderEnded({
  child,
  generation,
  onChild,
  seed,
  shot,
}: {
  child: ChildState;
  generation: GenerationSnapshot;
  onChild: (action: "rerun" | "retry") => void;
  seed: number;
  shot: WizardSearch;
}) {
  const unknown = generation.status === "unknown";
  const failure = failures[generation.error_code ?? "unknown"];
  const busy = child.state === "running";

  const changeShot = (
    <Button
      asChild
      size="lg"
      variant={unknown || failure.lead === "change" ? "default" : "outline"}
    >
      <Link search={{ ...shot, step: "direct" }} to="/genjutsu">
        Change the shot
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-lg text-pretty text-soft-foreground">
        {unknown
          ? "Comfy may still be rendering this one, so it isn't sent again. Start a new take instead: your picks are kept."
          : failure.text}
      </p>
      <div
        className={
          unknown
            ? "flex items-start gap-3.5 rounded-2xl border border-warning/40 bg-warning/6 px-5 py-4"
            : "flex items-start gap-3.5 rounded-2xl border border-destructive/40 bg-destructive/6 px-5 py-4"
        }
        role="alert"
      >
        <CircleAlertIcon
          aria-hidden="true"
          className={
            unknown
              ? "mt-0.5 size-5 shrink-0 text-warning"
              : "mt-0.5 size-5 shrink-0 text-destructive-foreground"
          }
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <span>
            {generation.error_message ??
              (unknown ? "The status of this take is unknown." : "The generation failed.")}
          </span>
          <span className="font-mono text-xs break-all text-muted-foreground">
            {generation.error_code ?? generation.status} · seed {seed}
          </span>
        </div>
      </div>
      {child.state === "refused" && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {child.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        {unknown ? (
          <>
            {changeShot}
            <Button asChild size="lg" variant="ghost">
              <Link search={{}} to="/genjutsu">
                New shot
              </Link>
            </Button>
          </>
        ) : (
          <>
            {failure.lead === "change" && changeShot}
            <Button
              disabled={busy}
              onClick={() => onChild("retry")}
              size="lg"
              variant={failure.lead === "retry" ? "default" : "outline"}
            >
              <RotateCwIcon />
              {child.state === "running" && child.action === "retry"
                ? "Retrying…"
                : "Retry with a new seed"}
            </Button>
            {failure.lead === "retry" && changeShot}
            <Button disabled={busy} onClick={() => onChild("rerun")} size="lg" variant="ghost">
              {child.state === "running" && child.action === "rerun"
                ? "Re-running…"
                : "Re-run same recipe"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** The heading of an ending that is not a video. */
export function endingTitle(generation: GenerationSnapshot) {
  return generation.status === "unknown"
    ? "This take's status is unknown"
    : failures[generation.error_code ?? "unknown"].title;
}
