import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type { MotionTransferDraft } from "#/features/motionTransfer/draft";
import { SummaryPanel, SummaryRow } from "#/shared/components/summary-panel";

/** One line of the slate: a pick or a direction, with its picture and a link to change it. */
export type SlateRow = {
  /** A link back to the step that sets it, once that step is behind. */
  change?: MotionTransferDraft;
  /** Shown while `value` is unset. */
  empty?: string;
  /** Stands in, in a dashed box, for what has no picture. */
  icon: LucideIcon;
  image?: string;
  label: string;
  /** A picture that is not a URL: a clip's still. */
  media?: React.ReactNode;
  value: string | null;
};

/**
 * "Your shot", the slate that sums up the picks: motion, character and look, each with a "Change"
 * link once its step is behind, then the step's `action` (Continue, or Generate), what stopped it
 * (`problems`) and a `note`. It sits beside the step, and under it where the width no longer holds
 * both.
 */
export function ShotSlate({
  action,
  note,
  problems,
  rows,
}: {
  action: React.ReactNode;
  note?: string;
  problems?: React.ReactNode;
  rows: SlateRow[];
}) {
  return (
    <SummaryPanel
      actions={
        <>
          {action}
          {problems}
        </>
      }
      label="Your shot"
      note={note}
    >
      {rows.map(({ change, empty, icon: Icon, image, label, media, value }) => (
        <SummaryRow
          action={
            change && (
              // Past the link's padding, so its text ends where the row does.
              <span className="-mr-1 flex">
                <Button asChild size="inline" variant="link">
                  <Link
                    aria-label={`Change ${label.toLowerCase()}`}
                    search={change}
                    to="/motionTransfer"
                  >
                    Change
                  </Link>
                </Button>
              </span>
            )
          }
          icon={<Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          image={image}
          key={label}
          label={label}
          media={media}
          placeholder={empty}
          value={value}
        />
      ))}
    </SummaryPanel>
  );
}
