import { Link } from "@tanstack/react-router";
import { XIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type { MotionTransferDraft } from "#/features/motionTransfer/draft";
import { StepTracker } from "#/shared/components/step-tracker";

/** One step of the stepper: where it stands, and the wizard screen it opens, if it opens one. */
export type HeaderStep = {
  label: string;
  search: MotionTransferDraft | null;
  state: "current" | "done" | "failed" | "todo";
};

/**
 * The row on top of every Motion Transfer page: the stepper (Motion → Character → Direct → Render,
 * `aria-current="step"` on the current one, earlier steps link back to their screen) and Exit, or
 * New shot once the take is done.
 */
export function MotionTransferHeader({
  end = "exit",
  steps,
}: {
  end?: "exit" | "new-shot";
  steps: HeaderStep[];
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-2 gap-y-2 sm:gap-x-6">
      <StepTracker
        steps={steps.map(({ label, search, state }) => ({
          label,
          link: search ? { search, to: "/motionTransfer" } : undefined,
          state,
        }))}
      />
      {end === "exit" ? (
        <Link
          className="inline-flex h-11 max-w-full items-center gap-1.5 rounded-sm px-1.5 type-caption font-medium text-soft-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          to="/"
        >
          <XIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">Exit</span>
        </Link>
      ) : (
        <Button asChild size="sm" variant="outline">
          <Link search={{}} to="/motionTransfer">
            New shot
          </Link>
        </Button>
      )}
    </div>
  );
}
