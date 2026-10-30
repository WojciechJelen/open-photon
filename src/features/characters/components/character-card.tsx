import { cn } from "cn";
import { ClapperboardIcon, EllipsisIcon, InfoIcon, PencilIcon, StarIcon } from "lucide-react";
import { type Ref, useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { CharacterImage } from "#/features/characters/components/character-image";
import type { CharacterSummary } from "#/features/characters/contracts";
import { characterName } from "#/features/characters/library";

/**
 * One character of the library: its picture (a placeholder when it does not load) with a favorite
 * star, its name, and on hover or focus (always, on a touch screen) "Animate" (`animateHref`, to the
 * Motion Transfer wizard with it picked) and a menu with Rename (not for a sample, whose title is
 * fixed) and Details (how it was made, and publishing). The menu's button is passed on to
 * `onRename` and `onDetails`: the focus goes back to it. `label` is what the card and its controls
 * are called to assistive technology (`accessibleNames`: an untitled one with its origin and when it
 * was added). `selected` rings it, as the character the page was opened on.
 */
export function CharacterCard({
  animateHref,
  character,
  favoritePending,
  label,
  onDetails,
  onFavorite,
  onRename,
  ref,
  selected,
}: {
  animateHref: string;
  character: CharacterSummary;
  favoritePending: boolean;
  label: string;
  onDetails: (menu: HTMLElement | null) => void;
  onFavorite: () => void;
  onRename: (menu: HTMLElement | null) => void;
  ref?: Ref<HTMLElement>;
  selected: boolean;
}) {
  const menu = useRef<HTMLButtonElement>(null);
  const name = characterName(character);
  const favorite = character.favorite_at !== null;

  return (
    <article
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      className="group/card flex min-w-0 flex-col gap-2.5 outline-none"
      data-character-id={character.id}
      ref={ref}
      tabIndex={-1}
    >
      <div
        className={cn(
          "relative aspect-4/7 overflow-hidden rounded-field bg-screen",
          selected ? "shadow-picked" : "shadow-hairline",
        )}
      >
        <CharacterImage character={character} tag="row" />
        <button
          aria-label={favorite ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
          aria-pressed={favorite}
          // Not `disabled`: the button keeps the keyboard focus while the change is saved.
          aria-disabled={favoritePending}
          className={cn(
            "group/star absolute top-1.5 right-1.5 grid size-11 cursor-pointer place-items-center outline-none",
            favorite ? "text-warning" : "text-foreground",
          )}
          onClick={() => !favoritePending && onFavorite()}
          type="button"
        >
          <span className="grid size-8 place-items-center rounded-full bg-background/60 transition-colors group-hover/star:bg-background/85 group-focus-visible/star:outline-2 group-focus-visible/star:outline-offset-2 group-focus-visible/star:outline-ring">
            <StarIcon aria-hidden="true" className="size-3.75" />
          </span>
        </button>
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-center gap-1.5 bg-linear-to-t from-background/78 to-transparent px-2 pt-8 pb-2.5 transition-opacity has-data-[state=open]:opacity-100 max-sm:gap-1 max-sm:px-1 can-hover:opacity-0 can-hover:group-focus-within/card:opacity-100 can-hover:group-hover/card:opacity-100">
          {/* Both are 36 px tall, as the board has them; their targets stay 44. */}
          <a
            aria-label={`Animate ${label}`}
            className="relative inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 type-caption font-semibold text-primary-foreground transition-colors before:absolute before:inset-x-0 before:-inset-y-1 hover:bg-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring motion-reduce:transition-none"
            href={animateHref}
          >
            <ClapperboardIcon aria-hidden="true" className="size-3.5" />
            Animate
          </a>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`More for ${label}`}
                className="group/more -m-1 grid size-11 cursor-pointer place-items-center outline-none"
                ref={menu}
                type="button"
              >
                <span className="grid size-9 place-items-center rounded-full border border-input bg-background/70 text-foreground transition-colors group-hover/more:bg-background/90 group-focus-visible/more:outline-2 group-focus-visible/more:outline-offset-3 group-focus-visible/more:outline-ring">
                  <EllipsisIcon aria-hidden="true" className="size-4" />
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!character.is_sample && (
                <DropdownMenuItem onSelect={() => onRename(menu.current)}>
                  <PencilIcon aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => onDetails(menu.current)}>
                <InfoIcon aria-hidden="true" />
                Details
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <h3 className="truncate type-label" title={name}>
        {name}
      </h3>
    </article>
  );
}
