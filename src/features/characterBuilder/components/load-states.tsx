import { ArrowLeftIcon, KeyRoundIcon, RotateCwIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type { Refusal } from "#/shared/requests";

/** The shape of a screen while its generation is read: grey blocks, announced by `label`. */
export function StepSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-4" role="status">
      <span className="sr-only">{label}…</span>
      <div className="h-5 w-40 animate-pulse rounded-full bg-foreground/8" />
      <div className="h-40 w-full animate-pulse rounded-2xl bg-foreground/6" />
      <div className="flex gap-2.5">
        <div className="h-11 w-44 animate-pulse rounded-full bg-foreground/8" />
        <div className="h-11 w-32 animate-pulse rounded-full bg-foreground/6" />
      </div>
    </div>
  );
}

/**
 * A generation the page could not read: no connection, no such generation, or the access code
 * expired (`access_required`, which asks for it). Read it again, or start over.
 */
export function LoadFailure({
  onBack,
  onReload,
  onUnlock,
  refusal,
}: {
  onBack: () => void;
  onReload: () => void;
  onUnlock: () => void;
  refusal: Refusal;
}) {
  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border border-destructive/40 bg-destructive/6 px-5 py-4"
      role="alert"
    >
      <p>{refusal.message}</p>
      <div className="flex flex-wrap gap-2.5">
        {refusal.reason === "access_required" ? (
          <Button onClick={onUnlock}>
            <KeyRoundIcon aria-hidden="true" />
            Enter access code
          </Button>
        ) : (
          <Button onClick={onReload}>
            <RotateCwIcon aria-hidden="true" />
            Load again
          </Button>
        )}
        <Button onClick={onBack} variant="outline">
          <ArrowLeftIcon aria-hidden="true" />
          Start from the description
        </Button>
      </div>
    </div>
  );
}
