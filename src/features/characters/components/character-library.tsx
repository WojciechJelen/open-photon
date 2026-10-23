import { KeyRoundIcon, RotateCcwIcon, SparklesIcon, StarIcon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { CharacterCard } from "#/features/characters/components/character-card";
import { CharacterUpload } from "#/features/characters/components/character-upload";
import { RenameDialog } from "#/features/characters/components/rename-dialog";
import type { CharacterSummary } from "#/features/characters/contracts";
import {
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
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import { useAccessCode } from "#/shared/use-access-code";

// The key the list's reload waits under for the access code (`useAccessCode`).
const HELD = "library-list";

/**
 * The workspace character library at `/characters`: every character of this installation's one
 * shared workspace (uploads, generated characters saved from the builder) and the samples, most
 * recent first, with search, a favorites filter, upload with likeness consent, rename, favorite,
 * and "Animate", which opens Motion Transfer with the character picked and the carried composer
 * draft (`search.draft`) kept. Without a session it lists nothing and explains the access code.
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
  const { favorites, q, selected } = search;
  const { reload, setState, state } = useCharacterList({ favorites, q });
  const access = useAccessCode();
  const [renaming, setRenaming] = useState<CharacterSummary | null>(null);
  const [pendingFavorite, setPendingFavorite] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const askForCode = useCallback(() => access.hold(HELD, "unlock", reload), [access.hold, reload]);

  const replace = useCallback(
    (character: CharacterSummary) =>
      setState((current) =>
        current.kind === "ready"
          ? {
              ...current,
              characters: current.characters.flatMap((each) =>
                each.id !== character.id
                  ? [each]
                  : favorites && character.favorite_at === null
                    ? []
                    : [character],
              ),
            }
          : current,
      ),
    [favorites, setState],
  );

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

  const signedIn = state.kind === "ready" || state.kind === "error";

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader>
        {state.kind !== "loading" && <AccessStatus onOpen={askForCode} signedIn={signedIn} />}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-4">
          <Hud>Library</Hud>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
              Characters
            </h1>
            {createCharacterHref && (
              <Button asChild variant="outline">
                <a href={createCharacterHref(search.draft)}>
                  <SparklesIcon aria-hidden="true" />
                  Describe a character
                </a>
              </Button>
            )}
          </div>
          <p className="flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 text-soft-foreground">
            <Badge>
              <UsersIcon />
              Shared workspace
            </Badge>
            <span>
              One library for this installation, shared by everyone who has an access code here:
              they all see, rename and animate the same characters. Uploaded photos are shown only
              with a code; a generated character's image is also on its generation's share page.
            </span>
          </p>
          {search.draft?.motion && (
            <p className="text-sm text-muted-foreground">
              Your motion and direction are kept: pick a character and Animate.
            </p>
          )}
        </div>

        {state.kind === "access" ? (
          <AccessRequired
            next={libraryHref("/characters", search.draft, selected)}
            onUnlock={askForCode}
          />
        ) : (
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-5">
              <Toolbar
                favorites={favorites ?? false}
                onFavorites={(next) => onSearch({ favorites: next || undefined })}
                onQuery={(next) => onSearch({ q: next || undefined })}
                query={q ?? ""}
              />
              {notice && (
                <p className="text-sm text-destructive-foreground" role="alert">
                  {notice}
                </p>
              )}
              <Results
                draft={search.draft}
                favorites={favorites ?? false}
                onFavorite={(character) => void toggleFavorite(character)}
                onRename={setRenaming}
                onRetry={reload}
                pendingFavorite={pendingFavorite}
                query={q ?? ""}
                selected={selected}
                state={state}
              />
            </div>
            <CharacterUpload
              className="order-first lg:order-none lg:w-80 lg:shrink-0"
              submitLabel="Add to library"
              hold={access.hold}
              onUploaded={(character) => {
                onSearch({ favorites: undefined, q: undefined, selected: character.id });
                reload();
              }}
              release={access.release}
            />
          </div>
        )}
      </main>
      <RenameDialog
        character={renaming}
        onAccessRequired={askForCode}
        onClose={() => setRenaming(null)}
        onRenamed={(character) => {
          replace(character);
          setRenaming(null);
        }}
      />
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}

/** The search box (debounced into the URL) and the favorites filter. */
function Toolbar({
  favorites,
  onFavorites,
  onQuery,
  query,
}: {
  favorites: boolean;
  onFavorites: (favorites: boolean) => void;
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
      <div className="min-w-0 flex-1 basis-56">
        <Input
          id={id}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search by name or description"
          type="search"
          value={text}
        />
      </div>
      <Button
        aria-pressed={favorites}
        onClick={() => onFavorites(!favorites)}
        size="sm"
        variant="chip"
      >
        <StarIcon aria-hidden="true" className={favorites ? "fill-warning text-warning" : ""} />
        Favorites only
      </Button>
    </div>
  );
}

/** The list as it stands: loading, a failed read to retry, nothing found, or the grid. */
function Results({
  draft,
  favorites,
  onFavorite,
  onRename,
  onRetry,
  pendingFavorite,
  query,
  selected,
  state,
}: {
  draft: LibrarySearch["draft"];
  favorites: boolean;
  onFavorite: (character: CharacterSummary) => void;
  onRename: (character: CharacterSummary) => void;
  onRetry: () => void;
  pendingFavorite: string | null;
  query: string;
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
      <div aria-busy="true" className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground" role="status">
          Loading the library…
        </p>
        <ul aria-hidden="true" className={gridClass}>
          {[0, 1, 2, 3].map((index) => (
            <li className="aspect-3/4 animate-pulse rounded-xl border bg-card" key={index} />
          ))}
        </ul>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        className="flex flex-col items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/8 p-5"
        role="alert"
      >
        <p className="font-semibold">The library could not be loaded.</p>
        <p className="text-sm text-soft-foreground">{state.refusal.message}</p>
        <Button onClick={onRetry} size="sm" variant="outline">
          <RotateCcwIcon aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  const { characters } = state;
  const filtered = query !== "" || favorites;
  const workspaceEmpty = !filtered && characters.every(({ is_sample }) => is_sample);

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {characters.length === 1 ? "1 character" : `${characters.length} characters`}
        {query !== "" && ` matching “${query}”`}
        {favorites && " in favorites"}
      </p>
      {workspaceEmpty && (
        <div
          className="flex flex-col gap-1.5 rounded-xl border border-dashed p-5"
          data-empty="workspace"
        >
          <p className="font-semibold">No characters of your own yet</p>
          <p className="text-sm text-soft-foreground">
            Add a photo, or describe a character and save it here. Until then, the samples below are
            ready to animate.
          </p>
        </div>
      )}
      {characters.length === 0 ? (
        <div
          className="flex flex-col gap-1.5 rounded-xl border border-dashed p-5"
          data-empty="results"
        >
          <p className="font-semibold">
            {favorites && query === "" ? "No favorites yet" : "No characters found"}
          </p>
          <p className="text-sm text-soft-foreground">
            {favorites && query === ""
              ? "Mark a character with its star to find it here."
              : "Try another name or description."}
          </p>
        </div>
      ) : (
        <ul aria-label="Characters" className={gridClass}>
          {characters.map((character) => (
            <li key={character.id}>
              <CharacterCard
                animateHref={animateHref(draft, character.id)}
                character={character}
                favoritePending={pendingFavorite === character.id}
                onFavorite={() => onFavorite(character)}
                onRename={() => onRename(character)}
                ref={character.id === selected ? selectedCard : undefined}
                selected={character.id === selected}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const gridClass = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4";

/** Without a session: what the library is, and how to get in. */
function AccessRequired({ next, onUnlock }: { next: string; onUnlock: () => void }) {
  return (
    <section
      aria-labelledby="library-access"
      className="flex max-w-2xl flex-col items-start gap-4 rounded-xl border bg-card p-6"
      data-state="access-required"
    >
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full border border-brand/35 bg-brand/12 text-brand-foreground"
      >
        <KeyRoundIcon className="size-5.5" />
      </span>
      <h2 className="text-xl font-semibold" id="library-access">
        Enter an access code to open the library
      </h2>
      <p className="text-soft-foreground">
        The character library opens with an access code: it is this installation's shared workspace,
        and uploaded photos are shown only with a code. Ask the owner of this installation for one;
        it lasts 12 hours.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onUnlock}>Enter access code</Button>
        <Button asChild variant="ghost">
          <a href={`/access?next=${encodeURIComponent(next)}`}>Use the access page</a>
        </Button>
      </div>
    </section>
  );
}
