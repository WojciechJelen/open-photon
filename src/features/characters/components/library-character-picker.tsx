import { cn } from "cn";
import { CheckIcon, LibraryIcon, LockIcon, SparklesIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { CharacterImage } from "#/features/characters/components/character-image";
import { CharacterUpload } from "#/features/characters/components/character-upload";
import type { PickableCharacter } from "#/features/characters/contracts";
import {
  characterName,
  type CreateCharacterHref,
  libraryHref,
  originLabel,
} from "#/features/characters/library";
import { useCharacterList } from "#/features/characters/use-character-list";
import type { CharacterPickerProps } from "#/features/motionTransfer/api";
import { Viewfinder } from "#/shared/components/brand";

/** A character as a pick: the whole tile toggles it (`aria-pressed`). */
function CharacterTile({
  character,
  onToggle,
  picked,
}: {
  character: PickableCharacter;
  onToggle: () => void;
  picked: boolean;
}) {
  return (
    <button
      aria-pressed={picked}
      className={cn(
        "relative block aspect-3/4 w-full cursor-pointer overflow-hidden rounded-xl border bg-card text-left text-foreground transition hover:-translate-y-0.5 hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
        picked && "border-transparent shadow-picked hover:border-transparent",
      )}
      onClick={onToggle}
      type="button"
    >
      <CharacterImage character={character} />
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-b from-transparent to-background/95"
      />
      <span className="absolute top-3 left-3">
        <Badge variant="solid">{originLabel(character)}</Badge>
      </span>
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
      <span className="absolute inset-x-3.5 bottom-3 line-clamp-2 text-base leading-tight font-semibold">
        {characterName(character)}
      </span>
    </button>
  );
}

/**
 * The Motion Transfer composer's character picker, backed by the workspace library (the
 * `characterPicker` slot, mounted in `src/app/composer-slots.ts`): a photo upload with likeness
 * consent, then, with a session, every character of the library (uploads, saved generated
 * characters, samples; most recent first), else the samples and the picked character. Links open
 * the library and, when the composition gives `createCharacterHref`, the builder, carrying the
 * composer draft (`draft`), so the picks and direction survive the trip back. A tile toggles the
 * pick (`onPick` with `undefined` unpicks).
 */
export function LibraryCharacterPicker({
  character,
  characterId,
  characters,
  createCharacterHref,
  draft,
  hold,
  onPick,
  release,
  signedIn,
}: CharacterPickerProps & { createCharacterHref?: CreateCharacterHref }) {
  const { reload, state: library } = useCharacterList({ enabled: signedIn });
  const listed = signedIn && library.kind === "ready" ? library.characters : characters;
  const missing = character && !listed.some(({ id }) => id === character.id) ? [character] : [];

  // A picked character this visitor may not see (an upload, without the code): a locked tile.
  const locked =
    characterId !== undefined && !character && !listed.some(({ id }) => id === characterId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={libraryHref("/characters", draft, characterId)}>
            <LibraryIcon aria-hidden="true" />
            Open the library
          </a>
        </Button>
        {createCharacterHref && (
          <Button asChild size="sm" variant="ghost">
            <a href={createCharacterHref(draft)}>
              <SparklesIcon aria-hidden="true" />
              Describe a character
            </a>
          </Button>
        )}
        {signedIn && library.kind === "loading" && (
          <span className="text-sm text-muted-foreground" role="status">
            Loading your library…
          </span>
        )}
        {signedIn && library.kind === "error" && (
          <span
            className="flex items-center gap-2 text-sm text-destructive-foreground"
            role="alert"
          >
            Your library could not be loaded; the samples are shown.
            <Button onClick={reload} size="inline" variant="link">
              Try again
            </Button>
          </span>
        )}
      </div>
      <ul
        aria-label="Characters"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
      >
        <li className="col-span-2">
          <CharacterUpload
            className="h-full"
            selectedId={characterId}
            submitLabel="Use photo"
            hold={hold}
            onUploaded={(uploaded) => {
              reload();
              onPick(uploaded.id);
            }}
            release={release}
          />
        </li>
        {locked && (
          <li>
            <button
              aria-pressed
              className="relative grid aspect-3/4 w-full cursor-pointer place-items-center overflow-hidden rounded-xl border border-transparent bg-card text-muted-foreground shadow-picked focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
              onClick={() => onPick(undefined)}
              type="button"
            >
              <span className="flex flex-col items-center gap-2 px-3 text-center">
                <LockIcon aria-hidden="true" className="size-7" />
                <span className="text-sm font-semibold text-foreground">
                  Your character, locked
                </span>
                <span className="text-xs">Enter the access code to see it.</span>
              </span>
            </button>
          </li>
        )}
        {[...missing, ...listed].map((each) => (
          <li key={each.id}>
            <CharacterTile
              character={each}
              onToggle={() => onPick(each.id === characterId ? undefined : each.id)}
              picked={each.id === characterId}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
