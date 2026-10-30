import { LockIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { CharacterImage } from "#/features/characters/components/character-image";
import { CharacterUpload } from "#/features/characters/components/character-upload";
import type { CharacterSummary } from "#/features/characters/contracts";
import {
  accessibleNames,
  characterName,
  type CreateCharacterHref,
  libraryHref,
} from "#/features/characters/library";
import { useCharacterList } from "#/features/characters/use-character-list";
import type { CharacterPickerProps } from "#/features/motionTransfer/api";
import { AddTile, PictureTile } from "#/shared/components/picture-tile";
import { ToolSection } from "#/shared/components/tool-layout";
import { revealInRow, revealPressed } from "#/shared/reveal-in-row";

// A grid of as many tiles as fit; on a phone one row that scrolls to the screen's edge, with room
// for the ring and the focus outline around a tile.
const listClass =
  "grid grid-fill-28 gap-3 max-sm:-my-0.5 max-sm:-mr-4 max-sm:-ml-1.5 max-sm:flex max-sm:gap-2.5 max-sm:overflow-x-auto max-sm:py-1.5 max-sm:pr-4 max-sm:pl-1.5";

const tileClass = "min-w-0 max-sm:w-24 max-sm:shrink-0";

/**
 * The Motion Transfer composer's character picker, backed by the workspace library (the
 * `characterPicker` slot, mounted in `src/app/composer-slots.ts`). It is the whole section: `title`
 * and `number` head it ("Character" unless the page words it otherwise), with links to the library
 * and, when the composition gives `createCharacterHref`, the builder, which carry the composer draft
 * (`draft`), so the picks and direction survive the trip back. Then a tile that adds a photo with
 * likeness consent and, with a session, every character of the library (uploads, saved generated
 * characters, samples; most recent first), else the samples and the picked character. A tile toggles
 * the pick (`onPick` with `undefined` unpicks).
 */
export function LibraryCharacterPicker({
  character,
  characterId,
  characters,
  createCharacterHref,
  draft,
  hold,
  number,
  onPick,
  release,
  signedIn,
  title = "Character",
}: CharacterPickerProps & { createCharacterHref?: CreateCharacterHref }) {
  const { reload, state: library } = useCharacterList({ enabled: signedIn });
  const [uploaded, setUploaded] = useState<CharacterSummary | null>(null);
  const listed = signedIn && library.kind === "ready" ? library.characters : characters;

  // What the list does not hold: a new upload, until the reads have it, and the pick.
  const unlisted = new Map(
    [uploaded, character].flatMap((each) =>
      each && !listed.some(({ id }) => id === each.id) ? [[each.id, each] as const] : [],
    ),
  );

  const shown = [...unlisted.values(), ...listed];

  // A picked character this visitor may not see (an upload, without the code): a locked tile.
  const locked = characterId !== undefined && !shown.some(({ id }) => id === characterId);
  const labels = accessibleNames(shown);
  const row = useRef<HTMLUListElement>(null);

  // The pick stays in sight in a phone's row: on the way back to it, once the library is read, and
  // when an upload picks a new tile.
  useEffect(() => revealPressed(row.current), [characterId, shown.length]);

  return (
    <ToolSection
      end={
        <div className="-mx-1 -my-2 flex max-w-full min-w-0 flex-wrap gap-x-2">
          <Button asChild size="inline" variant="link">
            <a href={libraryHref("/characters", draft, characterId)}>Open library</a>
          </Button>
          {createCharacterHref && (
            <Button asChild size="inline" variant="link">
              <a href={createCharacterHref(draft)}>Describe a new one</a>
            </Button>
          )}
        </div>
      }
      number={number}
      title={title}
    >
      {signedIn && library.kind === "loading" && (
        <span className="sr-only" role="status">
          Loading your library…
        </span>
      )}
      {/* The browser leaves a tile half out of the row when the keyboard lands on it. */}
      <ul
        aria-label="Characters"
        className={listClass}
        onFocus={(event) => revealInRow(event.target, event.currentTarget)}
        ref={row}
      >
        <li className={tileClass}>
          <CharacterUpload
            hold={hold}
            onUploaded={(added) => {
              setUploaded(added);
              reload();
              onPick(added.id);
            }}
            release={release}
            submitLabel="Use photo"
            trigger={(open) => <AddTile caption="Add a photo" onClick={open} />}
          />
        </li>
        {locked && (
          <li className={tileClass}>
            <PictureTile caption="Your character, locked" onClick={() => onPick(undefined)} pressed>
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center text-muted-foreground">
                <LockIcon aria-hidden="true" className="size-6" strokeWidth={1.75} />
                <span className="type-hint">Enter the access code to see it.</span>
              </span>
            </PictureTile>
          </li>
        )}
        {shown.map((each) => (
          <li className={tileClass} key={each.id}>
            <PictureTile
              // Said instead of the tile's text only when untitled (`accessibleNames`).
              aria-label={each.title ? undefined : labels.get(each.id)}
              caption={characterName(each)}
              onClick={() => onPick(each.id === characterId ? undefined : each.id)}
              pressed={each.id === characterId}
            >
              <CharacterImage character={each} tag="bottom" />
            </PictureTile>
          </li>
        ))}
      </ul>
      {signedIn && library.kind === "error" && (
        <div
          className="flex flex-wrap items-center gap-x-2 type-caption text-destructive-foreground"
          role="alert"
        >
          Your library could not be loaded; the samples are shown.
          <Button onClick={reload} size="inline" variant="link">
            Try again
          </Button>
        </div>
      )}
    </ToolSection>
  );
}
