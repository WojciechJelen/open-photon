import { cn } from "cn";
import type { ReactNode } from "react";

import { Hud } from "#/shared/components/brand";
import { Panel } from "#/shared/components/panel";

/**
 * The panel that sums up a shot ("Your shot"): its `label`, `SummaryRow`s, the `actions` under
 * them, stacked and full width, and an optional `note`.
 */
export function SummaryPanel({
  actions,
  children,
  className,
  label,
  note,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  label: string;
  note?: ReactNode;
}) {
  return (
    <Panel className={cn("gap-4 p-5", className)} label={label}>
      <div className="flex flex-col gap-3">{children}</div>
      {actions && <div className="flex flex-col gap-2">{actions}</div>}
      {note && (
        <p className="text-center type-caption text-pretty wrap-anywhere text-muted-foreground">
          {note}
        </p>
      )}
    </Panel>
  );
}

/**
 * One row of a `SummaryPanel`, parted from the row before it. `image` is a URL, `media` anything
 * else that fills the 44×56 box (a clip's still); `icon` stands in, in a dashed box, for what is
 * not chosen yet. Without a `value` the row says `placeholder`. `action` sits at the end: a Change
 * link.
 */
export function SummaryRow({
  action,
  icon,
  image,
  label,
  media,
  placeholder = "Next step",
  value,
}: {
  action?: ReactNode;
  icon?: ReactNode;
  image?: string;
  label: string;
  media?: ReactNode;
  placeholder?: string;
  value?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 not-first:border-t not-first:pt-3">
      {image || media ? (
        <span className="relative block h-14 w-11 shrink-0 overflow-hidden rounded-thumb bg-screen shadow-hairline">
          {media ?? <img alt="" className="absolute inset-0 size-full object-cover" src={image} />}
        </span>
      ) : (
        <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-thumb border border-dashed border-edge-strong text-muted-foreground">
          {icon}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Hud>{label}</Hud>
        {value ? (
          <span className="truncate text-sm font-semibold text-foreground" title={value}>
            {value}
          </span>
        ) : (
          <span className="truncate text-sm text-muted-foreground">{placeholder}</span>
        )}
      </div>
      {action && <div className="max-w-1/2 shrink-0">{action}</div>}
    </div>
  );
}
