import { ArrowLeftIcon, KeyRoundIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { StateCard } from "#/shared/components/state-card";
import type { Refusal } from "#/shared/requests";

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
    <div role="alert">
      <StateCard
        icon={TriangleAlertIcon}
        text={refusal.message}
        title="This could not be opened"
        tone="warning"
      >
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
      </StateCard>
    </div>
  );
}
