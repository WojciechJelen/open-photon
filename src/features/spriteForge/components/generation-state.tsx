import { cn } from "cn";
import { CircleHelpIcon, HourglassIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { retryGeneration } from "#/features/spriteForge/sprite-client";
import { StableText } from "#/shared/components/stable-text";
import { StateCard } from "#/shared/components/state-card";
import type { GenerationSnapshot } from "#/shared/contracts";
import type { HoldForCode } from "#/shared/use-access-code";

/** A `StateCard` that fills the box a picture will take, which keeps its radius and its line. */
export const FILLS_BOX = "absolute inset-0 min-h-0 rounded-none border-0 bg-transparent p-3";

/** The "AI-generated" tag of `ResultFigure`, for a sheet, which is shown in no figure. */
export function GeneratedTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "rounded-tag bg-background/66 px-1.75 py-0.75 type-tag text-foreground",
        className,
      )}
    >
      AI-generated
    </span>
  );
}

const fixedLabels = {
  cancelled: "Cancelled",
  done: "Done",
  failed: "Failed",
  finalizing: "Saving…",
  preparing: "Starting…",
  unknown: "Unknown",
} as const;

/** A generation's state in words, for its card's name. */
export function statusText({ position, progress, status }: GenerationSnapshot) {
  if (status === "waiting") {
    return position ? `Waiting · ${position} in line` : "Waiting";
  }

  if (status === "queued" || status === "running") {
    return progress === null ? "Queued on Comfy" : `Rendering ${progress}%`;
  }

  return fixedLabels[status];
}

function isFailed({ status }: GenerationSnapshot) {
  return status === "failed" || status === "cancelled";
}

/** The image a done generation saved as `name`, if it saved one. */
export function imageOutput(generation: GenerationSnapshot, name: string) {
  for (const output of generation.outputs) {
    if (output.name === name && output.media === "image") {
      return output.asset;
    }
  }

  return undefined;
}

/** The text a done generation saved as `name`, if it saved one. */
export function textOutput(generation: GenerationSnapshot, name: string) {
  for (const output of generation.outputs) {
    if (output.name === name && output.media === "text") {
      return output.text;
    }
  }

  return undefined;
}

/** The shared retry of one failed generation, holding it for the access code when one is due. */
function useRetry(generationId: string, hold: HoldForCode, onRetried: () => void) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setProblem(null);

    const result = await retryGeneration(generationId);

    setBusy(false);

    if ("data" in result) {
      onRetried();
    } else if (result.refusal.reason === "access_required") {
      hold(`retry-${generationId}`, "retry", () => void retry());
    } else {
      setProblem(result.refusal.message);
    }
  }

  return { busy, problem, retry };
}

/** Where a generation still on its way is, for its box. */
function waitingWords({ position, progress, status }: GenerationSnapshot) {
  if (status === "waiting") {
    return {
      text: position ? `Number ${position} in line.` : "It starts by itself.",
      title: "In line",
    };
  }

  if (status === "preparing") {
    return { text: "Sending it to Comfy.", title: "Starting…" };
  }

  if (status === "finalizing") {
    return { text: "Almost there.", title: "Saving…" };
  }

  return progress === null
    ? { text: "Comfy has it.", title: "Queued" }
    : { text: `${progress}%`, title: "Rendering" };
}

/** A text that may run long: cut short in a box with its whole text on hover. */
function Clamped({ children }: { children: string }) {
  return (
    <span className="line-clamp-4 sm:line-clamp-5" title={children}>
      {children}
    </span>
  );
}

/**
 * What a box says while its generation has no picture: how far it got, or why it stopped and, when
 * it failed or was cancelled, a way to try again. An unknown one offers none: Comfy may still be
 * rendering it. It fills the box, so the box stays the same from waiting to done. `backdrop` is the
 * character, blurred behind it.
 */
export function GenerationState({
  backdrop,
  generation,
  label,
  onAccess,
  onRetried,
  what,
}: {
  backdrop?: string;
  generation: GenerationSnapshot;
  /** Names the box for assistive tech: "Side", "Sheet". */
  label: string;
  onAccess: HoldForCode;
  onRetried: () => void;
  what: "sheet" | "view";
}) {
  const { busy, problem, retry } = useRetry(generation.id, onAccess, onRetried);

  if (isFailed(generation)) {
    const cancelled = generation.status === "cancelled";

    const reason =
      generation.error_message ?? `This ${what} ${cancelled ? "was cancelled" : "failed"}.`;

    return (
      <StateCard
        backdrop={backdrop}
        className={FILLS_BOX}
        heading="h3"
        icon={TriangleAlertIcon}
        text={problem ? <span role="alert">{problem}</span> : <Clamped>{reason}</Clamped>}
        title={cancelled ? "Cancelled" : "Didn't finish"}
        tone="warning"
      >
        <Button
          aria-label={`Try again: ${label}`}
          disabled={busy}
          onClick={() => void retry()}
          size="sm"
        >
          <RotateCwIcon aria-hidden="true" />
          <StableText current={busy ? "Trying…" : "Try again"} labels={["Try again", "Trying…"]} />
        </Button>
      </StateCard>
    );
  }

  if (generation.status === "unknown" || generation.status === "done") {
    return (
      <StateCard
        backdrop={backdrop}
        className={FILLS_BOX}
        heading="h3"
        icon={CircleHelpIcon}
        text={
          <Clamped>
            {generation.status === "done"
              ? `This ${what} saved no picture.`
              : "Comfy may already have it, so it is never sent again on its own."}
          </Clamped>
        }
        title={generation.status === "done" ? "No picture" : "Unknown"}
        tone="quiet"
      />
    );
  }

  const { text, title } = waitingWords(generation);

  return (
    <StateCard
      backdrop={backdrop}
      className={FILLS_BOX}
      heading="h3"
      icon={HourglassIcon}
      text={text}
      title={title}
      tone="quiet"
    >
      <span className="w-full max-w-50">
        <Progress aria-label={`${label} progress`} value={generation.progress ?? 0} />
      </span>
    </StateCard>
  );
}
