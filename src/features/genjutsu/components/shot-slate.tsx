import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";

import type { WizardSearch } from "#/features/genjutsu/wizard";
import { Hud } from "#/shared/components/brand";

/** One line of the slate: a pick or a direction, with its thumbnail and a link to change it. */
export type SlateRow = {
  /** A link back to the step that sets it, once it is set and that step is behind. */
  change?: WizardSearch;
  done: boolean;
  /** Shown while `value` is unset. */
  empty: string;
  icon: React.ReactNode;
  label: string;
  short?: boolean;
  thumb: React.ReactNode | null;
  value: string | null;
};

/** The thumbnail box: the pick's media, or a dashed placeholder with the row's icon. */
function Thumb({ row, small }: { row: SlateRow; small?: boolean }) {
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border",
        small ? "h-13 w-10" : row.short ? "h-10 w-13" : "h-17 w-13",
        row.thumb ? "border-brand/60 bg-muted" : "border-dashed border-input text-muted-foreground",
        !row.thumb && row.value && "border-brand/50 text-brand",
      )}
    >
      {row.thumb ?? (
        <span aria-hidden="true" className="*:size-4.5">
          {row.icon}
        </span>
      )}
    </span>
  );
}

function RowText({ row }: { row: SlateRow }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <Hud>{row.label}</Hud>
      <span
        className={cn(
          "truncate text-sm font-medium",
          row.value === null && "font-normal text-muted-foreground",
        )}
      >
        {row.value ?? row.empty}
      </span>
    </span>
  );
}

/**
 * "Your shot", the slate that summarizes the picks: motion, character, camera and look, each
 * with a "Change" link once its step is behind, then the step's action (Continue, or Generate)
 * and a note. From `lg` it is a panel beside the step; narrower, a bar fixed to the bottom with
 * the current step's row (`barRow`) and the action.
 */
export function ShotSlate({
  action,
  barRow,
  note,
  rows,
}: {
  action: (place: "bar" | "panel") => React.ReactNode;
  barRow: SlateRow;
  note: string;
  rows: SlateRow[];
}) {
  return (
    <>
      <aside aria-label="Your shot" className="hidden w-80 shrink-0 lg:block xl:w-90">
        <div className="sticky top-6 flex flex-col gap-1 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-5">
          <div className="flex items-center justify-between gap-3 pb-3">
            <Hud tone="foreground">Your shot</Hud>
            <Hud>New take</Hud>
          </div>
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li className="flex items-center gap-3.5 border-t py-3 last:pb-5" key={row.label}>
                <Thumb row={row} />
                <RowText row={row} />
                {row.change ? (
                  <Link
                    aria-label={`Change ${row.label.toLowerCase()}`}
                    className="inline-flex min-h-11 items-center rounded-sm text-sm text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground hover:decoration-brand focus-visible:outline-2 focus-visible:outline-ring"
                    search={row.change}
                    to="/genjutsu"
                  >
                    Change
                  </Link>
                ) : row.done ? (
                  <CheckIcon
                    aria-label="Done"
                    className="size-4.5 text-brand"
                    role="img"
                    strokeWidth={2.4}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          <div className="grid">{action("panel")}</div>
          <p className="pt-3 text-center text-sm text-pretty text-muted-foreground">{note}</p>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t bg-popover/92 px-4 pt-3 pb-6 backdrop-blur-md lg:hidden">
        <Thumb row={barRow} small />
        <RowText row={barRow} />
        {action("bar")}
      </div>
    </>
  );
}
