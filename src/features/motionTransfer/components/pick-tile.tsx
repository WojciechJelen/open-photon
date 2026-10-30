import { cn } from "cn";
import { CheckIcon } from "lucide-react";

/**
 * A clip to pick: 9:16, set before its media loads, with its title and `meta` under it. The whole
 * tile is one toggle button (`aria-pressed`), so a click or Enter or Space anywhere on it picks it,
 * and again unpicks it. Picked, it gets the ring around its own box and a check, so picking moves
 * nothing. `children` fill the frame.
 */
export function PickTile({
  children,
  meta,
  onToggle,
  picked,
  title,
}: {
  children: React.ReactNode;
  meta?: React.ReactNode;
  onToggle: () => void;
  picked: boolean;
  title: string;
}) {
  return (
    <button
      aria-pressed={picked}
      className="group/tile flex w-full min-w-0 cursor-pointer flex-col gap-2.5 text-left outline-none"
      onClick={onToggle}
      type="button"
    >
      <span
        className={cn(
          "relative block aspect-9/16 w-full overflow-hidden rounded-field bg-screen group-focus-visible/tile:outline-2 group-focus-visible/tile:outline-offset-3 group-focus-visible/tile:outline-ring",
          picked ? "shadow-picked" : "shadow-hairline",
        )}
      >
        {children}
        {picked && (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 grid size-5.5 place-items-center rounded-full bg-brand text-primary-foreground"
          >
            <CheckIcon className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-baseline justify-between gap-2">
        <span
          className={cn(
            "truncate type-label group-hover/tile:text-foreground",
            picked ? "text-foreground" : "text-soft-foreground",
          )}
          title={title}
        >
          {title}
        </span>
        {meta}
      </span>
    </button>
  );
}

/** Media that fills a tile, cropped to it. */
export const tileMedia = "absolute inset-0 size-full object-cover";
