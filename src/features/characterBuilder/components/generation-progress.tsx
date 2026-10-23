import { cn } from "cn";
import { CheckIcon, CircleAlertIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { Hud } from "#/shared/components/brand";
import type { GenerationSnapshot } from "#/shared/contracts";

/** What is being made, in the words each stage uses. */
export type Making = "caption" | "image";

const stageWords: Record<Making, Record<string, { active: string; title: string }>> = {
  caption: {
    finalizing: { active: "Saving the caption", title: "Finishing" },
    preparing: { active: "Sending your description to Comfy", title: "Preparing" },
    queued: { active: "Waiting for a free GPU", title: "Queued" },
    running: { active: "The prompt upsampler writes the caption", title: "Writing" },
    waiting: { active: "Waiting for a free rendering slot", title: "In line" },
  },
  image: {
    finalizing: { active: "Saving the image", title: "Finishing" },
    preparing: { active: "Sending the caption to Comfy", title: "Preparing" },
    queued: { active: "Waiting for a free GPU", title: "Queued" },
    running: { active: "FLUX 3 Klein renders your character", title: "Rendering" },
    waiting: { active: "Waiting for a free rendering slot", title: "In line" },
  },
};

const stageOrder = ["waiting", "preparing", "queued", "running", "finalizing"] as const;

/**
 * A caption or image on its way: the stages `waiting → preparing → queued → running →
 * finalizing`, the current one with Comfy's real progress (or, in line, its place), and a notice
 * while Comfy cannot be asked. The work goes on on the server whether or not the page is open.
 */
export function GenerationProgress({
  generation,
  making,
  providerUnavailable,
}: {
  generation: GenerationSnapshot;
  making: Making;
  providerUnavailable: boolean;
}) {
  const current = stageOrder.findIndex((status) => status === generation.status);
  const percent = generation.progress ?? 0;
  const words = stageWords[making];
  const position = generation.status === "waiting" ? generation.position : null;
  const currentTitle = words[generation.status]?.title ?? "Finishing";

  return (
    <div className="flex flex-col gap-4">
      <p
        aria-live="polite"
        className="inline-flex items-center gap-2 hud text-muted-foreground"
        data-status={generation.status}
        role="status"
      >
        {position === null ? currentTitle : `In line · #${position}`}
        {generation.status === "running" && ` · ${percent}%`}
      </p>
      <ol
        aria-label={making === "caption" ? "Caption stages" : "Image stages"}
        className="rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 px-5 py-1.5"
      >
        {stageOrder.map((status, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          const stage = words[status];

          return (
            <li
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-3.5 border-t py-3 first:border-t-0",
                state === "todo" && "text-muted-foreground",
              )}
              key={status}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border border-input font-mono text-xs",
                  state === "done" && "border-brand/50 bg-brand/16 text-brand",
                  state === "current" &&
                    "border-transparent bg-linear-100 from-brand via-brand-mid to-brand-2 font-semibold text-primary-foreground",
                )}
              >
                {state === "done" ? <CheckIcon className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="flex flex-col">
                  <b className={state === "todo" ? "text-soft-foreground" : undefined}>
                    {stage?.title}
                  </b>
                  {state === "current" && (
                    <span className="text-sm text-soft-foreground">
                      {status === "waiting" && position !== null
                        ? `Number ${position} in line for a free rendering slot`
                        : stage?.active}
                    </span>
                  )}
                </span>
                {state === "current" && status === "running" && (
                  <Progress
                    aria-label={making === "caption" ? "Caption progress" : "Image progress"}
                    value={percent}
                  />
                )}
              </span>
              <Hud tone={state === "current" ? "foreground" : "muted"}>
                {state === "done"
                  ? "Done"
                  : state === "current"
                    ? status === "running"
                      ? `${percent}%`
                      : position !== null
                        ? `#${position}`
                        : "Now"
                    : ""}
              </Hud>
            </li>
          );
        })}
      </ol>
      {providerUnavailable && (
        <p
          className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/5 px-5 py-4 text-sm text-soft-foreground"
          role="status"
        >
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-warning" />
          Comfy can't be reached right now, so this is the last known status. The page keeps trying
          on its own.
        </p>
      )}
    </div>
  );
}

type ErrorCode = NonNullable<GenerationSnapshot["error_code"]>;

/** Each way a generation fails, in plain words (`generationErrorCodeSchema`). */
const failureText: Record<ErrorCode, string> = {
  finalize_failed:
    "Comfy finished, but the result could not be downloaded or stored after three tries.",
  interrupted: "The server stopped before it sent this to Comfy, so nothing ran.",
  provider_failed:
    "Comfy stopped the job partway through, or it ended without a result. This also happens when the model is not available on the rendering backend.",
  provider_rejected:
    "Comfy refused the job, so nothing ran. Its model may be missing on the rendering backend.",
  provider_unreachable: "The connection to Comfy failed, so the job never reached it.",
  target_mismatch:
    "This was sent to another rendering endpoint than the one this server uses now, so it can't be followed from here.",
  timeout: "A request to Comfy ran out of time, or the job expired there.",
  unknown: "Something unexpected stopped it.",
};

/**
 * A caption or image that ended without a result: why, in plain words, the stored message and
 * code, Try again (`onTryAgain`, while an action runs `pending`) for a failed or cancelled one,
 * and the page's other actions (`children`). An `unknown` one may still be running on Comfy, so
 * it is never sent again: it gets no Try again, only a change of request.
 */
export function GenerationFailure({
  children,
  generation,
  making,
  onTryAgain,
  pending,
}: {
  children: React.ReactNode;
  generation: GenerationSnapshot;
  making: Making;
  onTryAgain: () => void;
  pending: string | null;
}) {
  const unknown = generation.status === "unknown";
  const noun = making === "caption" ? "caption" : "image";

  const text =
    generation.status === "cancelled"
      ? "It was cancelled while it waited for a rendering slot, so nothing ran or was charged."
      : unknown
        ? "Comfy may still be working on it, so it is never sent again from here: that could pay for it twice. Check the rendering backend for the job, or change the request and send that instead."
        : failureText[generation.error_code ?? "unknown"];

  return (
    <div className="flex flex-col gap-5">
      <div
        className={cn(
          "flex items-start gap-3.5 rounded-2xl border px-5 py-4",
          unknown ? "border-warning/40 bg-warning/6" : "border-destructive/40 bg-destructive/6",
        )}
        role="alert"
      >
        <CircleAlertIcon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-5 shrink-0",
            unknown ? "text-warning" : "text-destructive-foreground",
          )}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <b>
            {unknown
              ? `The ${noun}'s status is unknown`
              : generation.status === "cancelled"
                ? `The ${noun} was cancelled`
                : `The ${noun} couldn't be made`}
          </b>
          <span className="text-soft-foreground">{text}</span>
          {generation.error_message && (
            <span className="font-mono text-xs break-all text-muted-foreground">
              {generation.error_code ?? generation.status} · {generation.error_message}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {(generation.status === "failed" || generation.status === "cancelled") && (
          <Button disabled={pending !== null} onClick={onTryAgain} size="lg">
            <RotateCcwIcon aria-hidden="true" />
            {pending === "again"
              ? "Starting…"
              : making === "caption"
                ? "Try again"
                : "Try again with a new seed"}
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}
