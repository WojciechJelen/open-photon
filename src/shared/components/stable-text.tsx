import { cn } from "cn";

/**
 * A label that changes in place: every one of `labels` shares one grid cell, so the box is as wide
 * as the widest and a button keeps its width when `current` changes. Only `current` is shown and
 * read out. In a box too narrow for it, it ends in an ellipsis, with its whole text on hover.
 */
export function StableText({
  className,
  current,
  labels,
}: {
  className?: string;
  current: string;
  labels: readonly string[];
}) {
  return (
    <span
      className={cn("inline-grid max-w-full min-w-0 grid-cols-1 justify-items-center", className)}
    >
      {labels.map((label) => (
        <span
          aria-hidden={label === current ? undefined : true}
          className={cn(
            "col-start-1 row-start-1 max-w-full truncate",
            label !== current && "invisible",
          )}
          key={label}
          title={label === current ? label : undefined}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
