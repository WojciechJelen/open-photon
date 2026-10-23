// The workspace library's client helpers: the `/characters` page's search, the reads and writes
// it makes through the API, and how it names and describes a character. Client-safe.
import { defaultStringifySearch } from "@tanstack/react-router";
import { z } from "zod";

import {
  characterListSchema,
  type CharacterSummary,
  characterSummarySchema,
  characterTitleSchema,
} from "#/features/characters/contracts";
import {
  carriedDraft,
  carryDraft,
  draftHref,
  type DraftSnapshot,
  withCharacter,
} from "#/features/motionTransfer/api";
import { callApi } from "#/shared/requests";

const librarySearchSchema = z.object({
  favorites: z.boolean().optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  selected: z.uuid().optional().catch(undefined),
});

export type LibrarySearch = z.output<typeof librarySearchSchema> & {
  draft: DraftSnapshot | undefined;
};

/**
 * `/characters`' search: `q` (the search box), `favorites` (the favorites only), `selected` (the
 * character to focus, as the builder's save names it) and `draft`, the composer draft Motion
 * Transfer carries through the library (`carriedDraft`: its picks and direction, without step or
 * character), so a motion and direction picked before survive to "Animate". What does not
 * validate is dropped, like a mangled link's draft.
 */
export function validateLibrarySearch(search: {
  draft?: unknown;
  favorites?: unknown;
  q?: unknown;
  selected?: unknown;
}): LibrarySearch {
  return { ...librarySearchSchema.parse(search), draft: carriedDraft(search.draft) };
}

/**
 * Where "Animate" goes: the Motion Transfer wizard on `draft` with this character picked; with a
 * motion in the draft it opens on Direct, without one on motion selection.
 */
export function animateHref(draft: DraftSnapshot | undefined, characterId: string) {
  return draftHref(withCharacter(draft ?? {}, characterId));
}

/** `/characters` (or the builder, `/characters/new`) carrying `draft`, and `selected` if given. */
export function libraryHref(
  path: "/characters" | "/characters/new",
  draft: DraftSnapshot | undefined,
  selected?: string,
) {
  return `${path}${defaultStringifySearch({ ...carryDraft(draft), selected })}`;
}

/**
 * Where "Describe a character" leads, carrying the composer draft: given by the composition
 * (`libraryHref("/characters/new", draft)` once the builder's page exists), never assumed here.
 */
export type CreateCharacterHref = (draft: DraftSnapshot | undefined) => string;

/**
 * `GET /api/characters`: the workspace library and the samples, most recent first; `q` and
 * `favorites` filter it.
 */
export function fetchLibrary(
  { favorites, q }: { favorites?: boolean; q?: string },
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();

  if (q) {
    search.set("q", q);
  }

  if (favorites) {
    search.set("favorites", "1");
  }

  const query = search.toString();

  return callApi(characterListSchema, `/api/characters${query ? `?${query}` : ""}`, {
    headers: { Accept: "application/json" },
    method: "GET",
    signal,
  });
}

/** `PATCH /api/characters/:id`: a new title, (un)marking a favorite, or both. */
export function patchCharacter(id: string, patch: { favorite?: boolean; title?: string }) {
  return callApi(characterSummarySchema, `/api/characters/${id}`, {
    body: JSON.stringify(patch),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

/** The image types the file picker offers (`POST /api/characters` checks the content itself). */
export const uploadTypes = ["image/png", "image/jpeg", "image/webp"];

/**
 * `POST /api/characters`: an uploaded photo, with the uploader's likeness consent, which the
 * caller asks for first (the server refuses an upload without it, `consent_required`).
 */
export function uploadCharacter(file: File, signal?: AbortSignal) {
  const form = new FormData();

  form.append("consent", "true");
  form.append("image", file);

  return callApi(characterSummarySchema, "/api/characters", { body: form, method: "POST", signal });
}

/** Whether `title` is one a character may take (1–80 characters once trimmed). */
export function validTitle(title: string) {
  return characterTitleSchema.safeParse(title).success;
}

/** What a character is called and where it comes from, as every read of the API has it. */
type CharacterIdentity = Pick<CharacterSummary, "is_sample" | "origin" | "title">;

/** What the library calls a character: its title, or what it is when it has none. */
export function characterName(character: CharacterIdentity) {
  if (character.title) {
    return character.title;
  }

  return character.origin === "upload" ? "Untitled photo" : "Untitled character";
}

/** Where a character comes from, as its badge says. */
export function originLabel(character: CharacterIdentity) {
  if (character.is_sample) {
    return "Sample";
  }

  // A generated character's image is a model's output: said so plainly (the FLUX licence asks
  // for AI-generated outputs to be disclosed as such).
  return character.origin === "upload" ? "Uploaded" : "AI-generated";
}

/**
 * What each character of one list is called to assistive technology, by id: its title, or, for
 * one without a title, what it is, where it came from and when it was added (in UTC, so the
 * server and the browser render the same words), numbered when two untitled ones would still
 * read the same. The rename, favorite and animate controls of a card or tile say which character
 * they act on with it.
 */
export function accessibleNames(
  characters: readonly Pick<
    CharacterSummary,
    "created_at" | "id" | "is_sample" | "origin" | "title"
  >[],
) {
  const named = characters.map((character) => {
    if (character.title) {
      return [character.id, character.title] as const;
    }

    const added = `${character.created_at.slice(0, 10)} ${character.created_at.slice(11, 16)} UTC`;
    const origin = character.origin === "upload" ? "uploaded" : "AI-generated";

    return [character.id, `${characterName(character)}, ${origin} ${added}`] as const;
  });

  const seen = new Map<string, number>();

  return new Map(
    named.map(([id, name]) => {
      const count = (seen.get(name) ?? 0) + 1;

      seen.set(name, count);

      return [id, count === 1 ? name : `${name} (${count})`];
    }),
  );
}

/** A model file's name without its extension, as the provenance line shows it. */
export function modelName(file: string) {
  return file.replace(/\.(safetensors|gguf|ckpt|pt|bin)$/i, "");
}
