import {
  ImagePlusIcon,
  KeyRoundIcon,
  SearchIcon,
  SearchXIcon,
  SparklesIcon,
  StarIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { CharacterCard } from "#/features/characters/components/character-card";
import { CharacterDetails } from "#/features/characters/components/character-details";
import { CharacterUpload } from "#/features/characters/components/character-upload";
import { RenameDialog, type RenameSession } from "#/features/characters/components/rename-dialog";
import type { CharacterSummary } from "#/features/characters/contracts";
import {
  accessibleNames,
  animateHref,
  type LibrarySearch,
  type CreateCharacterHref,
  libraryHref,
  patchCharacter,
} from "#/features/characters/library";
import {
  type CharacterListState,
  useCharacterList,
} from "#/features/characters/use-character-list";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { PageHeading } from "#/shared/components/page-heading";
import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";
import { useAccessCode } from "#/shared/use-access-code";
import { useSession } from "#/shared/use-session";

// The key the list's reload waits under for the access code (`useAccessCode`).
const HELD = "library-list";

/**
 * The workspace character library at `/characters`: every character of this installation's one
 * shared workspace (uploads, generated characters saved from the builder) and the samples, most
 * recent first, with search, a filter (all, favorites, samples), upload with likeness consent,
 * rename, favorite, details, and "Animate", which opens Motion Transfer with the character picked
 * and the carried composer draft (`search.draft`) kept. Without a session it lists nothing and
 * explains the access code.
 * `onSearch` changes the page's search (the URL), replacing its history entry. The builder's
 * "Describe a character" shows only when the composition gives `createCharacterHref` (the route
 * that mounts the page passes it once the builder exists), so the page never links nowhere.
 */
export function CharacterLibrary({
  createCharacterHref,
  onSearch,
  search,
}: {
  createCharacterHref?: CreateCharacterHref;
  onSearch: (next: Partial<LibrarySearch>) => void;
  search: LibrarySearch;
}) {
  const { favorites, q, samples, selected } = search;
  const session = useSession();

  const { reload, setState, state } = useCharacterList({
    enabled: session !== null,
    favorites,
    q,
  });

  const access = useAccessCode();
  const [renaming, setRenaming] = useState<RenameSession | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const sessions = useRef(0);
  // The card's menu button a dialog was opened from, and the page's heading, where the focus goes
  // back to when that is gone (a rename the search no longer matches).
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLSpanElement>(null);
  const [pendingFavorite, setPendingFavorite] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const askForCode = useCallback(() => access.hold(HELD, "unlock", reload), [access.hold, reload]);

  // The filters the list shows now. A change that completes later (a rename answered after the
  // search changed) is judged by these, never by the ones of the render that started it.
  const filters = useRef({ favorites, q });

  useEffect(() => {
    filters.current = { favorites, q };
  }, [favorites, q]);

  // Puts a changed character in the list it belongs to, as `GET /api/characters` decides it: a
  // favorite under `favorites`, a title or prompt containing `q`; else out of the list.
  const replace = useCallback(
    (character: CharacterSummary) =>
      setState((current) => {
        if (current.kind !== "ready") {
          return current;
        }

        const needle = filters.current.q?.toLocaleLowerCase() ?? "";

        const matches =
          (!filters.current.favorites || character.favorite_at !== null) &&
          (needle === "" ||
            [character.title, character.prompt].some((text) =>
              text?.toLocaleLowerCase().includes(needle),
            ));

        return {
          ...current,
          characters: current.characters.flatMap((each) =>
            each.id !== character.id ? [each] : matches ? [character] : [],
          ),
        };
      }),
    [setState],
  );

  function startRename(character: CharacterSummary, menu: HTMLElement | null) {
    opener.current = menu;
    sessions.current += 1;
    setRenaming({ character, id: sessions.current });
  }

  function refocus() {
    const target = opener.current?.isConnected ? opener.current : heading.current;

    target?.focus();
  }

  async function toggleFavorite(character: CharacterSummary) {
    setPendingFavorite(character.id);
    setNotice(null);

    const result = await patchCharacter(character.id, {
      favorite: character.favorite_at === null,
    });

    setPendingFavorite(null);

    if ("data" in result) {
      replace(result.data);
    } else if (result.refusal.reason === "access_required") {
      askForCode();
    } else {
      setNotice(`The favorite was not saved: ${result.refusal.message}`);
    }
  }

  const listed = state.kind === "ready" ? state.characters : [];
  const details = listed.find(({ id }) => id === inspected) ?? null;

  // The server knows there is no session from the first paint: no list to wait for.
  const locked = state.kind === "access" || (state.kind === "loading" && session === null);

  return (
    <SitePage gap={7} onAccess={askForCode} top={10}>
      <PageHeading
        actions={
          <>
            <CharacterUpload
              hold={access.hold}
              onUploaded={(character) => {
                onSearch({
                  favorites: undefined,
                  q: undefined,
                  samples: undefined,
                  selected: character.id,
                });
                reload();
              }}
              release={access.release}
              submitLabel="Add to library"
              trigger={(open) => (
                <Button onClick={open} variant="outline">
                  <ImagePlusIcon aria-hidden="true" />
                  Add a photo
                </Button>
              )}
            />
            {createCharacterHref && (
              <Button asChild>
                <a href={createCharacterHref(search.draft)}>
                  <SparklesIcon aria-hidden="true" />
                  Describe a character
                </a>
              </Button>
            )}
          </>
        }
        subtitle={
          search.draft?.motion
            ? "Your motion and direction are kept: pick a character and Animate."
            : "Shared with everyone in this workspace."
        }
        title={
          <span className="outline-none" ref={heading} tabIndex={-1}>
            Characters
          </span>
        }
      />

      {locked ? (
        <AccessRequired
          next={libraryHref("/characters", search.draft, selected)}
          onUnlock={askForCode}
        />
      ) : (
        <>
          <Toolbar
            filter={favorites ? "favorites" : samples ? "samples" : "all"}
            notice={notice}
            onFilter={(next) =>
              onSearch({
                favorites: next === "favorites" || undefined,
                samples: next === "samples" || undefined,
              })
            }
            onQuery={(next) => onSearch({ q: next || undefined })}
            query={q ?? ""}
          />
          <Results
            draft={search.draft}
            favorites={favorites ?? false}
            onDetails={(character, menu) => {
              opener.current = menu;
              setInspected(character.id);
            }}
            onFavorite={(character) => void toggleFavorite(character)}
            onRename={startRename}
            onRetry={reload}
            pendingFavorite={pendingFavorite}
            query={q ?? ""}
            samples={Boolean(samples) && !favorites}
            selected={selected}
            state={state}
          />
        </>
      )}

      <RenameDialog
        onAccessRequired={askForCode}
        onClose={() => setRenaming(null)}
        onClosed={refocus}
        onRenamed={(character, session) => {
          // The list takes every saved name; only the dialog that saved it closes, not one
          // opened for another character since.
          // At once, then as the server lists it now (a read started before the save landed
          // would otherwise bring the old name back).
          replace(character);
          reload();
          setRenaming((current) => (current?.id === session ? null : current));
        }}
        session={renaming}
      />
      <CharacterDetails
        character={details}
        label={details ? (accessibleNames(listed).get(details.id) ?? "") : ""}
        onClose={() => setInspected(null)}
        onClosed={refocus}
        onPublished={(character, slug) => replace({ ...character, share_slug: slug })}
      />
      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}

const filters = [
  { label: "All", value: "all" },
  { label: "Favorites", value: "favorites" },
  { label: "Samples", value: "samples" },
] as const;

/**
 * The search box (debounced into the URL), the filter and, in the room beside them, a change that
 * was not saved (`notice`).
 */
function Toolbar({
  filter,
  notice,
  onFilter,
  onQuery,
  query,
}: {
  filter: (typeof filters)[number]["value"];
  notice: string | null;
  onFilter: (filter: string) => void;
  onQuery: (query: string) => void;
  query: string;
}) {
  const id = useId();
  const [text, setText] = useState(query);
  const typed = useRef(query);
  const report = useRef(onQuery);

  useEffect(() => {
    report.current = onQuery;
  }, [onQuery]);

  // A search from the URL (Back, a link) replaces what was typed.
  useEffect(() => {
    if (query !== typed.current.trim()) {
      typed.current = query;
      setText(query);
    }
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim() !== query) {
        typed.current = text;
        report.current(text.trim());
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, text]);

  return (
    <div className="flex flex-wrap items-center gap-3" role="search">
      <label className="sr-only" htmlFor={id}>
        Search characters
      </label>
      {/* The input keeps its own styles; only the room for the icon is added from here. */}
      <div className="relative max-w-105 min-w-0 flex-1 basis-70 [&_input]:pl-10">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-muted-foreground"
          strokeWidth={1.75}
        />
        <Input
          id={id}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search characters"
          type="search"
          value={text}
        />
      </div>
      <ToggleGroup
        aria-label="Filter characters"
        // Choosing the filter that is on says nothing: one always stays on.
        onValueChange={(next) => next && onFilter(next)}
        spacing={1}
        type="single"
        value={filter}
        variant="segmented"
      >
        {filters.map(({ label, value }) => (
          <ToggleGroupItem key={value} value={value}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {notice && (
        <p
          className="min-w-0 flex-1 basis-60 type-caption wrap-anywhere text-destructive-foreground"
          role="alert"
        >
          {notice}
        </p>
      )}
    </div>
  );
}

/** The list as it stands: loading, a failed read to retry, nothing found, or the grid. */
function Results({
  draft,
  favorites,
  onDetails,
  onFavorite,
  onRename,
  onRetry,
  pendingFavorite,
  query,
  samples,
  selected,
  state,
}: {
  draft: LibrarySearch["draft"];
  favorites: boolean;
  onDetails: (character: CharacterSummary, menu: HTMLElement | null) => void;
  onFavorite: (character: CharacterSummary) => void;
  onRename: (character: CharacterSummary, menu: HTMLElement | null) => void;
  onRetry: () => void;
  pendingFavorite: string | null;
  query: string;
  samples: boolean;
  selected: string | undefined;
  state: Exclude<CharacterListState, { kind: "access" }>;
}) {
  const focused = useRef<string | null>(null);
  const selectedCard = useRef<HTMLElement | null>(null);

  // The character the page was opened on (or just uploaded) is brought into view once.
  useEffect(() => {
    if (
      state.kind === "ready" &&
      selected &&
      focused.current !== selected &&
      selectedCard.current
    ) {
      focused.current = selected;
      selectedCard.current.scrollIntoView({ block: "center" });
      selectedCard.current.focus({ preventScroll: true });
    }
  }, [selected, state]);

  if (state.kind === "loading") {
    return (
      <div aria-busy="true">
        <p className="sr-only" role="status">
          Loading the library…
        </p>
        <ul aria-hidden="true" className={gridClass}>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <li className="flex flex-col gap-2.5" key={index}>
              <span className="aspect-4/7 skeleton rounded-field" />
              <span className="h-5 w-2/3 skeleton rounded-full" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div role="alert">
        <StateCard
          icon={TriangleAlertIcon}
          text={state.refusal.message}
          title="The library didn't load"
          tone="warning"
        >
          <Button onClick={onRetry} variant="outline">
            Try again
          </Button>
        </StateCard>
      </div>
    );
  }

  // The server reads the favorites; the samples come from the whole list, once it is here.
  const characters =
    samples && !state.favorites
      ? state.characters.filter(({ is_sample }) => is_sample)
      : state.characters;

  // Said of the list as it was read: one still on its way keeps the words of the list it replaces.
  const noFavorites = state.favorites === true && !state.q;
  const labels = accessibleNames(characters);

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {characters.length === 1 ? "1 character" : `${characters.length} characters`}
        {query !== "" && ` matching “${query}”`}
        {favorites && " in favorites"}
        {samples && " in samples"}
      </p>
      {characters.length === 0 ? (
        <div data-empty="results">
          <StateCard
            icon={noFavorites ? StarIcon : SearchXIcon}
            text={
              noFavorites
                ? "Mark a character with its star to find it here."
                : "Try another name or description."
            }
            title={noFavorites ? "No favorites yet" : "No characters match"}
          />
        </div>
      ) : (
        <ul aria-label="Characters" className={gridClass}>
          {characters.map((character) => (
            <li className="min-w-0" key={character.id}>
              <CharacterCard
                animateHref={animateHref(draft, character.id)}
                character={character}
                favoritePending={pendingFavorite === character.id}
                label={labels.get(character.id) ?? ""}
                onDetails={(menu) => onDetails(character, menu)}
                onFavorite={() => onFavorite(character)}
                onRename={(menu) => onRename(character, menu)}
                ref={character.id === selected ? selectedCard : undefined}
                selected={character.id === selected}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const gridClass = "grid tiles-fill-42 gap-4";

/** Without a session: what the library is, and how to get in. */
function AccessRequired({ next, onUnlock }: { next: string; onUnlock: () => void }) {
  return (
    <div data-state="access-required">
      <StateCard
        icon={KeyRoundIcon}
        text="It is this workspace's shared library. Ask the owner of this installation for a code; it lasts 12 hours."
        title="Enter an access code to open the library"
      >
        <Button onClick={onUnlock}>Enter access code</Button>
        <Button asChild variant="ghost">
          <a href={`/access?next=${encodeURIComponent(next)}`}>Use the access page</a>
        </Button>
      </StateCard>
    </div>
  );
}
