// Prompt composition for the look editor: the direction's `prompt` is the one place a look lives
// (the wizard keeps it in its URL), so the editor reads the picks back out of it (`readLook`) and
// writes the whole prompt again for every edit (`composeLook`). Pure and deterministic; loadable by
// Node (`tests/compose.test.ts`).
import {
  backgroundBase,
  characterBase,
  type LookCatalog,
  lookCatalog,
  type LookGroup,
  lookGroups,
  type LookOption,
} from "./catalog.ts";

/** The option picked in each group, by id; a group left out has none. */
export type LookSelection = Partial<Record<LookGroup, string>>;

/** A prompt as the editor shows it: the visitor's own words and the options picked. */
export type Look = { description: string; selection: LookSelection };

/** `text` without the occurrence of `fragment` at `at` and the one space that joined it. */
function cut(text: string, at: number, fragment: string) {
  const end = at + fragment.length;

  if (text[at - 1] === " ") {
    return text.slice(0, at - 1) + text.slice(end);
  }

  return text.slice(0, at) + text.slice(text[end] === " " ? end + 1 : end);
}

/**
 * `text` without any catalog fragment, each occurrence taken out with the space that joined it,
 * and the options whose fragments it held, at most one per group: the catalog's first.
 */
function takeFragments(text: string, catalog: LookCatalog) {
  const found: LookOption[] = [];
  let rest = text;

  for (const option of catalog.options) {
    let at = rest.indexOf(option.fragment);

    if (at === -1) {
      continue;
    }

    if (!found.some(({ group }) => group === option.group)) {
      found.push(option);
    }

    while (at !== -1) {
      rest = cut(rest, at, option.fragment);
      at = rest.indexOf(option.fragment);
    }
  }

  return { found, rest };
}

/**
 * A background sentence in the visitor's words: one that starts with `Background:` (as every
 * background fragment and a preset's look do) or `Background as in` (`backgroundBase`), through
 * the end of its sentence (`.`, `!` or `?` before a space or the end), its line or the text.
 */
const backgroundSentence = /(?<=^|\s)Background(?::| as in )[^]*?(?:[.!?](?=\s|$)|(?=\n)|$)/;

/**
 * `description` without its background sentences (`backgroundSentence`), each taken out with the
 * space that joined it, and the sentences `taken`. When that leaves only `characterBase`, the
 * description is blank: `composeLook` leads a picked background with that sentence, and `readLook`
 * reads it so.
 */
function takeBackground(description: string) {
  const taken: string[] = [];
  let rest = description;

  for (let match = backgroundSentence.exec(rest); match; match = backgroundSentence.exec(rest)) {
    taken.push(match[0]);
    rest = cut(rest, match.index, match[0]);
  }

  return { rest: taken.length > 0 && rest === characterBase ? "" : rest, taken };
}

/**
 * The look `prompt` holds. Every catalog fragment found in it is a pick and comes out of the
 * description, each occurrence with the space that joined it, so a fragment never shows twice;
 * when one group's fragments appear more than once, the catalog's first is the pick. What is left
 * is the visitor's description, character for character, except that with picks the leading
 * sentences `composeLook` adds to an empty description (`characterBase`, `backgroundBase`) read
 * as empty. A fragment of an older catalog version is not in `catalog`, so it stays in the
 * description.
 */
export function readLook(prompt: string, catalog: LookCatalog = lookCatalog): Look {
  const { found, rest } = takeFragments(prompt, catalog);
  const selection: LookSelection = Object.fromEntries(found.map(({ group, id }) => [group, id]));

  const description =
    found.length > 0 && (rest === characterBase || rest === `${characterBase} ${backgroundBase}`)
      ? ""
      : rest;

  return { description, selection };
}

/**
 * `look` with the description typed or pasted as `text`. A catalog fragment in it is a pick, as
 * a click on its tile would make it (`pickOption`: it replaces its group's, drops conflicting
 * picks, and a background takes the place of the other background sentences of the text), and
 * comes out of the description, so the description never holds a fragment: picking that option
 * again cannot add it twice, and removing it leaves none behind. `found` names the options taken
 * from the text.
 */
export function editDescription(
  look: Look,
  text: string,
  catalog: LookCatalog = lookCatalog,
): DescriptionEdit {
  const { found, rest } = takeFragments(text, catalog);
  const dropped: LookOption[] = [];
  const replaced: string[] = [];
  let next: Look = { ...look, description: rest };

  for (const option of found) {
    const picked = pickOption(next, option.id, catalog);

    next = picked.look;
    dropped.push(...picked.dropped);
    replaced.push(...picked.replaced);
  }

  return { dropped, found, look: next, replaced };
}

/** What `editDescription` gives: `pickOption`'s result and the options found in the text. */
type DescriptionEdit = PickResult & { found: LookOption[] };

/** The options `selection` names, in group order; an unknown id names none. */
export function pickedOptions(
  selection: LookSelection,
  catalog: LookCatalog = lookCatalog,
): LookOption[] {
  return lookGroups.flatMap((group) => {
    const option = catalog.options.find(({ id }) => id === selection[group]);

    return option?.group === group ? [option] : [];
  });
}

/**
 * The prompt for `look`: the description as typed, then one fragment per picked group, in group
 * order (background, lighting, look), joined by single spaces. Without picks it is the description
 * alone, so a blank one stays blank (the workflow's default). With picks and a blank description,
 * `characterBase` leads, followed by `backgroundBase` unless a background is picked: the
 * workflow's default prompt with the picks added. `readLook` gives `look` back.
 */
export function composeLook(look: Look, catalog: LookCatalog = lookCatalog): string {
  const picked = pickedOptions(look.selection, catalog);

  if (picked.length === 0) {
    return look.description;
  }

  const lead =
    look.description.trim() === ""
      ? [characterBase, ...(look.selection.background === undefined ? [backgroundBase] : [])]
      : [look.description];

  return [...lead, ...picked.map(({ fragment }) => fragment)].join(" ");
}

/**
 * `look` with `optionId` picked: it replaces its group's pick, and drops the picks it conflicts
 * with (either side naming the other in `conflicts`), which come back as `dropped` so the editor
 * can say so. A background also replaces the background sentences of the description (a
 * preset's look, a take's prompt read back, the visitor's words), which come back as `replaced`,
 * so the prompt never asks for two backgrounds. Picking the option already picked changes nothing
 * else.
 */
export function pickOption(
  look: Look,
  optionId: string,
  catalog: LookCatalog = lookCatalog,
): PickResult {
  const option = catalog.options.find(({ id }) => id === optionId);

  if (!option) {
    return { dropped: [], look, replaced: [] };
  }

  const dropped = pickedOptions(look.selection, catalog).filter(
    (other) =>
      other.group !== option.group &&
      (option.conflicts.includes(other.id) || other.conflicts.includes(option.id)),
  );

  const selection: LookSelection = { ...look.selection, [option.group]: option.id };

  for (const other of dropped) {
    delete selection[other.group];
  }

  const { rest, taken } =
    option.group === "background"
      ? takeBackground(look.description)
      : { rest: look.description, taken: [] };

  return { dropped, look: { description: rest, selection }, replaced: taken };
}

/**
 * What `pickOption` gives: the next look, the picks it dropped for a conflict, and the background
 * sentences a picked background took out of the description.
 */
type PickResult = { dropped: LookOption[]; look: Look; replaced: string[] };

/** `look` without its pick in `group`. */
export function removeGroup(look: Look, group: LookGroup): Look {
  const selection = { ...look.selection };

  delete selection[group];

  return { ...look, selection };
}
