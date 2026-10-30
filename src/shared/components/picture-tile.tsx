import { cn } from "cn";
import { CheckIcon, PlusIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

const tile =
  "group/tile flex w-full min-w-0 cursor-pointer flex-col gap-2 text-left outline-none disabled:cursor-not-allowed";

// The focus ring sits on the picture: the button around it also holds the caption.
const frame =
  "group-focus-visible/tile:outline-2 group-focus-visible/tile:outline-offset-3 group-focus-visible/tile:outline-ring";

/** A tile's one-line caption, cut short with its whole text on hover. */
function TileCaption({
  children,
  selected,
  strong,
}: {
  children: string;
  selected?: boolean;
  strong?: boolean;
}) {
  return (
    <span
      className={cn(
        "truncate text-soft-foreground group-hover/tile:text-foreground",
        strong ? "type-label" : "type-caption font-medium",
        selected && "font-semibold text-foreground",
      )}
      title={children}
    >
      {children}
    </span>
  );
}

/**
 * A picture to pick, with its caption under it: 4:7 unless `aspect` says otherwise, set before the
 * image loads. `pressed` draws the ring and the check around its own box, so picking one moves
 * nothing; a grid or row of them leaves the ring 4 px of room (`p-1 -m-1` in a scrolling row).
 * `children` replaces the image (a clip's still, say). `strong` sets the caption as a name, 14/600,
 * for tiles that are one of a few big choices. `ringOnly` leaves the check out, for those the
 * boards mark with the ring alone. `tagged` says "AI-generated" on the picture, for a saved
 * character (a sample says so in its alt text).
 */
export function PictureTile({
  alt,
  aspect = "aspect-4/7",
  caption,
  children,
  className,
  position,
  pressed,
  ringOnly = false,
  src,
  strong = false,
  tagged = false,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  alt?: string;
  aspect?: string;
  caption: string;
  children?: ReactNode;
  position?: string;
  pressed: boolean;
  ringOnly?: boolean;
  src?: string;
  strong?: boolean;
  tagged?: boolean;
}) {
  return (
    <button aria-pressed={pressed} className={cn(tile, className)} type="button" {...props}>
      <span
        className={cn(
          "relative block w-full overflow-hidden rounded-lg bg-screen",
          aspect,
          pressed ? "shadow-picked" : "shadow-hairline",
          frame,
        )}
      >
        {children ?? (
          <img
            alt={alt ?? caption}
            className={cn("absolute inset-0 size-full object-cover", position)}
            src={src}
          />
        )}
        {tagged && (
          // A tile of a phone's row is 96 px wide: the tag fits with less around it. Its alt text
          // says the same to assistive technology.
          <span
            aria-hidden="true"
            className="absolute bottom-2 left-2 rounded-tag bg-background/66 px-1.75 py-0.75 type-tag whitespace-nowrap text-foreground max-sm:bottom-1 max-sm:left-1 max-sm:px-1"
          >
            AI-generated
          </span>
        )}
        {pressed && !ringOnly && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-brand text-primary-foreground"
          >
            <CheckIcon className="size-3" strokeWidth={3} />
          </span>
        )}
      </span>
      <TileCaption selected={pressed} strong={strong}>
        {caption}
      </TileCaption>
    </button>
  );
}

/** The dashed tile that adds a picture, beside `PictureTile`s: the same box and caption. */
export function AddTile({
  aspect = "aspect-4/7",
  caption,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & { aspect?: string; caption: string }) {
  return (
    <button className={cn(tile, className)} type="button" {...props}>
      <span
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-edge-strong bg-foreground/2 text-soft-foreground group-hover/tile:text-foreground group-disabled/tile:text-muted-foreground",
          aspect,
          frame,
        )}
      >
        <PlusIcon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <TileCaption>{caption}</TileCaption>
    </button>
  );
}
