import { PlayIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type {
  DirectGenerationActionsProps,
  ResultGenerationActionsProps,
} from "#/features/motionTransfer/slots";
import { StableText } from "#/shared/components/stable-text";

/** The Direct step's default generation action: Generate, which submits the step's form. */
export function GenerateButton({ formId, pending }: DirectGenerationActionsProps) {
  return (
    <Button disabled={pending} form={formId} type="submit" variant="photon">
      <PlayIcon />
      {pending ? "Starting…" : "Generate"}
    </Button>
  );
}

/** A finished take's default generation action: Re-run its recipe, in the result's row of links. */
export function RerunButton({ child, onRerun }: ResultGenerationActionsProps) {
  return (
    <Button disabled={child.state === "running"} onClick={onRerun} size="inline" variant="link">
      <StableText
        current={child.state === "running" ? "Re-running…" : "Re-run recipe"}
        labels={["Re-run recipe", "Re-running…"]}
      />
    </Button>
  );
}
