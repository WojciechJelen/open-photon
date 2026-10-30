import { cn } from "cn";
import { CheckIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { StableText } from "#/shared/components/stable-text";
import { StateCard } from "#/shared/components/state-card";
import type { GenerationSnapshot } from "#/shared/contracts";

/** What is being made, in the words each stage uses. */
export type Making = "caption" | "image";

const activeWords: Record<Making, Record<string, string>> = {
  caption: {
    finalizing: "Saving the prompt",
    preparing: "Sending your description to Comfy",
    queued: "Waiting for a free GPU",
    running: "The prompt upsampler writes your prompt",
    waiting: "Waiting for a free rendering slot",
  },
  image: {
    finalizing: "Saving the image",
    preparing: "Sending the prompt to Comfy",
    queued: "Waiting for a free GPU",
    running: "FLUX 3 Klein renders your character",
    waiting: "Waiting for a free rendering slot",
  },
};

/** The stages as the visitor reads them, each the generation statuses it stands for. */
const stages = [
  { label: "Getting ready", statuses: ["waiting", "preparing", "queued"] },
  { label: "Rendering", statuses: ["running"] },
  { label: "Finishing", statuses: ["finalizing"] },
] as const;

/**
 * A caption or image on its way: Comfy's real progress, the stages it goes through, what happens
 * now (or its place in line), and a notice while Comfy cannot be asked. The work goes on on the
 * server whether or not the page is open.
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
  const { position, status } = generation;
  const percent = generation.progress ?? 0;

  const current = stages.findIndex(({ statuses }) =>
    statuses.some((each: GenerationSnapshot["status"]) => each === status),
  );

  const word = activeWords[making][status] ?? "Finishing";

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <Progress
        aria-label={making === "caption" ? "Prompt progress" : "Image progress"}
        value={percent}
      />
      <ol className="flex flex-wrap justify-between gap-2">
        {stages.map(({ label }, index) => {
          const done = index < current;
          const active = index === current;
          const shown = making === "caption" && label === "Rendering" ? "Writing" : label;

          return (
            <li
              aria-current={active ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 type-caption font-medium",
                done && "text-soft-foreground",
                active && "text-foreground",
                !done && !active && "text-muted-foreground",
              )}
              key={label}
            >
              {done && <CheckIcon aria-hidden="true" className="size-3.5 text-brand-foreground" />}
              <span
                className={cn("reserve-semibold", active && "font-semibold")}
                data-label={shown}
              >
                {shown}
              </span>
            </li>
          );
        })}
      </ol>
      <p
        aria-live="polite"
        className="truncate type-hint text-muted-foreground"
        data-status={status}
        role="status"
      >
        {status === "waiting" && position !== null ? `Number ${position} in line` : word}
        {status === "running" && ` · ${percent}%`}
      </p>
      {providerUnavailable && (
        <p className="flex items-start gap-2 type-hint text-soft-foreground" role="status">
          <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-warning" />
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
 * the page's other actions (`children`) and, under the card, what a refused action said (`notice`).
 * An `unknown` one may still be running on Comfy, so it is never sent again: it gets no Try again,
 * only a change of request.
 */
export function GenerationFailure({
  children,
  generation,
  making,
  notice,
  onTryAgain,
  pending,
}: {
  children: React.ReactNode;
  generation: GenerationSnapshot;
  making: Making;
  notice: React.ReactNode;
  onTryAgain: () => void;
  pending: string | null;
}) {
  const unknown = generation.status === "unknown";
  const noun = making === "caption" ? "prompt" : "image";
  const retry = making === "caption" ? "Try again" : "Try again with a new seed";

  const text =
    generation.status === "cancelled"
      ? "It was cancelled while it waited for a rendering slot, so nothing ran or was charged."
      : unknown
        ? "Comfy may still be working on it, so it is never sent again from here: that could pay for it twice. Check the rendering backend for the job, or change the request and send that instead."
        : failureText[generation.error_code ?? "unknown"];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="alert">
        <StateCard
          icon={TriangleAlertIcon}
          text={
            <>
              {text}
              {generation.error_message && (
                <span className="mt-2 line-clamp-4 block font-mono type-hint wrap-anywhere text-muted-foreground">
                  {generation.error_code ?? generation.status} · {generation.error_message}
                </span>
              )}
            </>
          }
          title={
            unknown
              ? `The ${noun}'s status is unknown`
              : generation.status === "cancelled"
                ? `The ${noun} was cancelled`
                : `The ${noun} couldn't be made`
          }
          tone="warning"
        >
          {(generation.status === "failed" || generation.status === "cancelled") && (
            <Button disabled={pending !== null} onClick={onTryAgain}>
              <RotateCcwIcon aria-hidden="true" />
              <StableText
                current={pending === "again" ? "Starting…" : retry}
                labels={[retry, "Starting…"]}
              />
            </Button>
          )}
          {children}
        </StateCard>
      </div>
      {notice}
    </div>
  );
}
