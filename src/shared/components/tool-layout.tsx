import { cn } from "cn";
import type { ReactNode } from "react";

import { Hud } from "#/shared/components/brand";

/**
 * A tool's two columns: the form that takes the room, and `aside` (a `SummaryPanel`) beside it. When
 * the width no longer holds both, the aside wraps under the form at its full width. `asideLabel`
 * names the aside for assistive technology; `asideClassName` adds to it, for what only it can do,
 * such as staying in view (`sticky top-6`).
 */
export function ToolColumns({
  aside,
  asideClassName,
  asideLabel,
  children,
}: {
  aside: ReactNode;
  asideClassName?: string;
  asideLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-7 sm:gap-10">
      <div className="flex min-w-0 grow-999 basis-140 flex-col gap-7 sm:gap-9">{children}</div>
      <aside aria-label={asideLabel} className={cn("min-w-0 flex-1 basis-85", asideClassName)}>
        {aside}
      </aside>
    </div>
  );
}

/**
 * A titled step of a form: its `number` as a readout ("01") when the form counts them, `title`, and
 * `end` (links, a note such as "Optional") on the same line, wrapping under it when it must.
 */
export function ToolSection({
  children,
  end,
  number,
  title,
}: {
  children: ReactNode;
  end?: ReactNode;
  number?: string;
  title: string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex min-w-0 items-baseline gap-3 type-section">
          {number && (
            <Hud className="shrink-0 whitespace-nowrap" tone="brand">
              {number}
            </Hud>
          )}
          <span className="min-w-0 wrap-anywhere">{title}</span>
        </h2>
        {end}
      </div>
      {children}
    </section>
  );
}
