import { Link, type LinkProps } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";

/** One step: where it stands, and the screen it opens when it is not the current one. */
export type TrackedStep = {
  label: string;
  link?: LinkProps;
  state: "current" | "done" | "failed" | "todo";
};

function StepMark({ number, state }: { number: number; state: TrackedStep["state"] }) {
  if (state === "done") {
    return (
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/18 text-brand-foreground"
      >
        <CheckIcon className="size-3.25" strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full type-readout",
        state === "current" && "bg-render text-primary-foreground",
        state === "failed" && "bg-destructive text-primary-foreground",
        state === "todo" && "border border-input text-muted-foreground",
      )}
    >
      {state === "failed" ? "!" : number}
    </span>
  );
}

/**
 * The numbered steps of a flow: a check on those done, the render gradient on the current one
 * (`aria-current="step"`), a link back on any with a `link`. On a phone only the current step keeps
 * its word, the others are read out but not shown, so the row never wraps.
 */
export function StepTracker({ className, steps }: { className?: string; steps: TrackedStep[] }) {
  return (
    <nav aria-label="Steps" className={cn("max-w-full min-w-0", className)}>
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const active = step.state === "current" || step.state === "failed";

          const body = (
            <>
              <StepMark number={index + 1} state={step.state} />
              <span
                className={cn(
                  "reserve-semibold min-w-0 overflow-hidden type-caption font-medium whitespace-nowrap",
                  active && "font-semibold text-foreground",
                  step.state === "done" && "text-soft-foreground",
                  step.state === "todo" && "text-muted-foreground",
                  !active && "max-sm:sr-only",
                )}
                data-label={step.label}
              >
                {step.label}
              </span>
            </>
          );

          const row = "flex min-h-11 min-w-0 items-center gap-2 rounded-full";

          return (
            <li className="flex min-w-0 items-center gap-2" key={step.label}>
              {step.link && step.state !== "current" ? (
                <Link
                  {...step.link}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    row,
                    "hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    // A phone hides its word: 44 px around the mark, with no room taken.
                    !active && "max-sm:-mx-2.5 max-sm:w-11 max-sm:justify-center",
                  )}
                >
                  {body}
                </Link>
              ) : (
                <span
                  aria-current={active ? "step" : undefined}
                  aria-disabled={step.state === "todo" ? true : undefined}
                  className={row}
                >
                  {body}
                </span>
              )}
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-6 shrink-0",
                    step.state === "done" ? "bg-brand/50" : "bg-input",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
