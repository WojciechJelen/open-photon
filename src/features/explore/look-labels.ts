// Short names for the looks of the examples shown, for the gallery's filter chips and cards.
// Client-safe and loadable by Node as is, so `npm run test:server` exercises it.

/** How long a look's name may be, so a chip fits a phone. */
const MAX_LABEL = 44;

const SEPARATOR = " · ";

/** The sentences of a look, trimmed; text after the last full stop is one more. */
function sentencesOf(text: string) {
  return (text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

/** A sentence as a name: without a leading `Word: ` and its closing punctuation. */
function named(sentence: string) {
  const unprefixed = sentence.replace(/^[A-Z][a-z]+:\s+/, "");
  const bare = unprefixed.replace(/[.!?]+$/, "");

  return unprefixed === sentence ? bare : `${bare.charAt(0).toUpperCase()}${bare.slice(1)}`;
}

/** `text` in at most `max` characters: its first whole words and "…" when it is longer. */
function clip(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }

  let kept = "";

  for (const word of text.split(" ")) {
    const next = kept ? `${kept} ${word}` : word;

    if (next.length > max - 1) {
      break;
    }

    kept = next;
  }

  return `${(kept || text.slice(0, max - 1)).replace(/[,;:]$/, "")}…`;
}

/**
 * A name for each look (by `key`) that tells it apart from the others. A look is a prompt whose
 * sentences are often shared: the looks editor leads every composed look with the same sentence
 * about the character, then adds one per pick. A look none of whose sentences any other look has
 * (the only one, say) is named by its first sentence; any other by the sentences no other look
 * has, else by those not every look has. Each sentence loses a leading `Background: ` (any
 * `Word: `) and its full stop; they share `MAX_LABEL` characters, cut at whole words, joined with
 * " · ".
 */
export function lookLabels(looks: { key: string; text: string }[]) {
  const split = looks.map(({ key, text }) => ({ key, sentences: sentencesOf(text) }));

  const sharers = (key: string, sentence: string) =>
    split.filter((other) => other.key !== key && other.sentences.includes(sentence)).length;

  return new Map(
    split.map(({ key, sentences }) => {
      const own = sentences.filter((sentence) => sharers(key, sentence) === 0);

      const notEverywhere = sentences.filter(
        (sentence) => sharers(key, sentence) < split.length - 1,
      );

      const parts = (
        own.length === sentences.length
          ? sentences.slice(0, 1)
          : own.length > 0
            ? own
            : notEverywhere.length > 0
              ? notEverywhere
              : sentences
      ).map(named);

      const room = Math.floor((MAX_LABEL - SEPARATOR.length * (parts.length - 1)) / parts.length);

      return [key, parts.map((part) => clip(part, room)).join(SEPARATOR) || "No look"];
    }),
  );
}
