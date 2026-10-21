import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon, XIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type { WizardSearch } from "#/features/motionTransfer/wizard";
import { AccessStatus } from "#/shared/components/access-code-dialog";
import { BrandLogo, BrandMark, Hud } from "#/shared/components/brand";

/** One step of the stepper: where it stands, and the wizard screen it opens, if it opens one. */
export type HeaderStep = {
  label: string;
  search: WizardSearch | null;
  state: "current" | "done" | "failed" | "todo";
};

function StepNumber({ index, state }: { index: number; state: HeaderStep["state"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full border border-input font-mono text-xs",
        state === "done" && "border-brand/50 bg-brand/16 text-brand",
        state === "current" &&
          "border-transparent bg-linear-100 from-brand via-brand-mid to-brand-2 font-semibold text-primary-foreground",
        state === "failed" &&
          "border-transparent bg-destructive font-semibold text-primary-foreground",
      )}
    >
      {state === "done" ? (
        <CheckIcon className="size-3.5" strokeWidth={3} />
      ) : state === "failed" ? (
        "!"
      ) : (
        index + 1
      )}
    </span>
  );
}

/**
 * The Motion Transfer header. From `lg`: the mark, the stepper (Motion → Character → Direct → Render,
 * `aria-current="step"` on the current one, earlier steps link back to their screen), the access
 * status and Exit (or New shot). Narrower: a compact bar with "Step N of 4" (or `mobileTitle`)
 * and a segmented progress bar.
 */
export function MotionTransferHeader({
  end = "exit",
  mobileStatus,
  onAccess,
  signedIn,
  steps,
}: {
  end?: "exit" | "new-shot";
  mobileStatus?: string;
  onAccess: () => void;
  signedIn: boolean;
  steps: HeaderStep[];
}) {
  const active = steps.findIndex((step) => step.state === "current" || step.state === "failed");
  // With no step current, every step is done: the bar is full.
  const current = active === -1 ? steps.length - 1 : active;

  return (
    <>
      <header className="hidden min-h-16 items-center gap-5 border-b px-8 py-2.5 lg:flex">
        <BrandMark />
        <span aria-hidden="true" className="text-edge-strong">
          /
        </span>
        <span className="font-semibold">Motion Transfer</span>
        <nav aria-label="Steps" className="mx-auto">
          <ol className="flex items-center gap-2.5">
            {steps.map((step, index) => {
              const body = (
                <>
                  <StepNumber index={index} state={step.state} />
                  <span className="sr-only xl:not-sr-only">{step.label}</span>
                </>
              );

              const className = cn(
                "flex min-h-11 items-center gap-2.5 rounded-full pr-1 text-sm font-medium whitespace-nowrap",
                step.state === "todo" && "text-muted-foreground",
                step.state === "done" && "text-soft-foreground",
                (step.state === "current" || step.state === "failed") && "text-foreground",
              );

              return (
                <li className="flex items-center gap-2.5" key={step.label}>
                  {index > 0 && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-px w-6 shrink-0 bg-input xl:w-9",
                        step.state !== "todo" && "bg-brand/60",
                      )}
                    />
                  )}
                  {step.search && step.state !== "current" ? (
                    <Link
                      className={cn(
                        className,
                        "hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
                      )}
                      search={step.search}
                      to="/motionTransfer"
                    >
                      {body}
                    </Link>
                  ) : (
                    <span
                      aria-current={
                        step.state === "current" || step.state === "failed" ? "step" : undefined
                      }
                      aria-disabled={step.state === "todo" ? true : undefined}
                      className={className}
                    >
                      {body}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex items-center gap-2">
          <AccessStatus onOpen={onAccess} signedIn={signedIn} />
          {end === "exit" ? (
            <Button asChild size="sm" variant="ghost">
              <Link to="/">Exit</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link search={{}} to="/motionTransfer">
                New shot
              </Link>
            </Button>
          )}
        </div>
      </header>

      <header className="flex flex-col gap-2.5 px-4 pt-2 pb-1 lg:hidden">
        <div className="flex items-center gap-2.5">
          <Link
            aria-label="Open Photon studio"
            className="grid size-11 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
            to="/"
          >
            <BrandLogo className="size-5.5" />
          </Link>
          <span className="font-semibold">Motion Transfer</span>
          <Hud className="ml-auto">{mobileStatus ?? `Step ${current + 1} of ${steps.length}`}</Hud>
          <AccessStatus compact onOpen={onAccess} signedIn={signedIn} />
          {end === "exit" ? (
            <Button asChild size="icon" variant="ghost">
              <Link aria-label="Exit" to="/">
                <XIcon className="size-5" />
              </Link>
            </Button>
          ) : (
            <Button asChild size="icon" variant="ghost">
              <Link aria-label="New shot" search={{}} to="/motionTransfer">
                <XIcon className="size-5" />
              </Link>
            </Button>
          )}
        </div>
        <div aria-hidden="true" className="grid grid-cols-4 gap-1">
          {steps.map((step, index) => (
            <span
              className={cn(
                "h-0.75 rounded-full bg-foreground/14",
                index <= current && "bg-linear-100 from-brand to-brand-2",
                step.state === "failed" && "bg-destructive",
              )}
              key={step.label}
            />
          ))}
        </div>
      </header>
    </>
  );
}
