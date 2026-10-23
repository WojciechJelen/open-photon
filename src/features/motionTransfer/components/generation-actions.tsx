import { PlayIcon, RotateCwIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type {
  DirectGenerationActionsProps,
  ResultGenerationActionsProps,
} from "#/features/motionTransfer/slots";

/** The Direct step's default generation action: Generate, which submits the step's form. */
export function GenerateButton({ formId, pending, place }: DirectGenerationActionsProps) {
  return (
    <Button
      disabled={pending}
      form={formId}
      size={place === "panel" ? "lg" : "default"}
      type="submit"
      variant="photon"
    >
      <PlayIcon className="fill-current" />
      {pending ? "Starting…" : "Generate"}
    </Button>
  );
}

/** A finished take's default generation action: Re-run its recipe. */
export function RerunButton({ child, onRerun }: ResultGenerationActionsProps) {
  return (
    <Button disabled={child.state === "running"} onClick={onRerun} size="sm" variant="outline">
      <RotateCwIcon />
      {child.state === "running" ? "Re-running…" : "Re-run recipe"}
    </Button>
  );
}
