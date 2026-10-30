import { cn } from "cn";
import { BookmarkCheckIcon, BookmarkPlusIcon, LoaderCircleIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";

/**
 * A figure's Save to library, among its `actions`: it turns the result into a character (`onSave`),
 * shows `saving` on its way, and from then on links to that character (`saved`, its id).
 */
export function SaveToLibrary({
  disabled,
  onSave,
  saved,
  saving,
}: {
  disabled: boolean;
  onSave: () => void;
  saved: string | null | undefined;
  saving: boolean;
}) {
  if (saved) {
    return (
      <Button
        aria-label="Saved to library"
        asChild
        size="icon"
        title="Saved to library"
        variant="scrim"
      >
        <a href={`/characters?selected=${saved}`}>
          <BookmarkCheckIcon aria-hidden="true" strokeWidth={1.75} />
        </a>
      </Button>
    );
  }

  return (
    <Button
      aria-label="Save to library"
      disabled={disabled}
      onClick={onSave}
      size="icon"
      title="Save to library"
      variant="scrim"
    >
      {saving ? (
        <LoaderCircleIcon
          aria-hidden="true"
          className="motion-safe:animate-spin"
          strokeWidth={1.75}
        />
      ) : (
        <BookmarkPlusIcon aria-hidden="true" strokeWidth={1.75} />
      )}
    </Button>
  );
}

/**
 * A finished picture: the "AI-generated" tag on it, `actions` (`Button size="icon" variant="scrim"`)
 * on a scrim along its bottom edge and, under it, `caption` cut to one line beside `meta`. The box
 * takes `aspect` before anything loads; `children` is the image or video, `absolute inset-0
 * size-full object-cover`. `revealActions` keeps the scrim out of the way until the figure is
 * hovered or holds focus; a device that cannot hover always shows it. Only its opacity changes.
 * `tag` is the tag's corner: `bottom` keeps it off the head of a figure too narrow to clear it, for
 * a figure without `actions`, whose scrim takes that edge.
 */
export function ResultFigure({
  actions,
  aspect = "aspect-4/7",
  caption,
  children,
  className,
  meta,
  revealActions = false,
  tag = "top",
}: {
  actions?: ReactNode;
  aspect?: string;
  caption?: string;
  children: ReactNode;
  className?: string;
  meta?: ReactNode;
  revealActions?: boolean;
  tag?: "bottom" | "top";
}) {
  return (
    <figure className={cn("group/figure m-0 flex min-w-0 flex-col gap-2.5", className)}>
      <div className={cn("relative overflow-hidden rounded-field border bg-screen", aspect)}>
        {children}
        <span
          className={cn(
            "absolute left-2 rounded-tag bg-background/66 px-1.75 py-0.75 type-tag text-foreground",
            tag === "top" ? "top-2" : "bottom-2",
          )}
        >
          AI-generated
        </span>
        {actions && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 flex justify-center gap-1.5 bg-linear-to-t from-background/72 to-transparent px-2.5 pt-7 pb-2.5",
              revealActions &&
                "transition-opacity can-hover:opacity-0 can-hover:group-focus-within/figure:opacity-100 can-hover:group-hover/figure:opacity-100",
            )}
          >
            {actions}
          </div>
        )}
      </div>
      {(caption || meta) && (
        <figcaption className="flex min-w-0 items-baseline justify-between gap-2">
          {caption && (
            <span className="min-w-0 truncate type-label" title={caption}>
              {caption}
            </span>
          )}
          {meta && (
            <span className="max-w-1/2 shrink-0 truncate type-caption text-muted-foreground">
              {meta}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
