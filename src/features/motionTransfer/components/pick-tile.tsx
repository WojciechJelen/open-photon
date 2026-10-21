import { cn } from "cn";
import { CheckIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Viewfinder } from "#/shared/components/brand";

/** The tile frame every pick and upload state shares: 3:4, rounded, on the card ground. */
export const tileFrame =
  "relative block aspect-3/4 w-full overflow-hidden rounded-xl border bg-card text-left text-foreground";

/**
 * A pickable tile: the whole tile is one toggle button (`aria-pressed`), so a click or Enter or
 * Space anywhere on it picks it, and again unpicks it. Picked, it gets the violet ring, the
 * viewfinder corners and a check. `media` fills it; `title` and `meta` sit at its foot.
 */
export function PickTile({
  media,
  meta,
  onToggle,
  picked,
  tag,
  title,
}: {
  media: React.ReactNode;
  meta?: React.ReactNode;
  onToggle: () => void;
  picked: boolean;
  tag?: string;
  title: string;
}) {
  return (
    <button
      aria-pressed={picked}
      className={cn(
        tileFrame,
        "cursor-pointer transition hover:-translate-y-0.5 hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
        picked && "border-transparent shadow-picked hover:border-transparent",
      )}
      onClick={onToggle}
      type="button"
    >
      {media}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-b from-transparent to-background/95"
      />
      {tag && (
        <span className="absolute top-3 left-3">
          <Badge variant="solid">{tag}</Badge>
        </span>
      )}
      {picked && (
        <>
          <Viewfinder className="inset-2.5" tone="brand" />
          <span
            aria-hidden="true"
            className="absolute top-3 right-3 grid size-7 place-items-center rounded-full bg-brand text-primary-foreground shadow-glow"
          >
            <CheckIcon className="size-4" strokeWidth={3} />
          </span>
        </>
      )}
      <span className="absolute inset-x-3.5 bottom-3 flex items-end justify-between gap-2">
        <span className="text-base leading-tight font-semibold">{title}</span>
        {meta}
      </span>
    </button>
  );
}

/** Media that fills a tile, cropped to it. */
export const tileMedia = "absolute inset-0 size-full object-cover";
