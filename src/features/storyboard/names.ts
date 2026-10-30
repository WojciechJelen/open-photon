// How the storyboard pages name a character and a storyboard, and describe a character's image.
// Client-safe.
type Named = { origin: "generated" | "upload"; title: string | null };

/** A character's title, or what it is when it has none. */
export function characterName({ origin, title }: Named) {
  if (title) {
    return title;
  }

  return origin === "upload" ? "Untitled photo" : "Untitled character";
}

/**
 * A character image's alt text: its name and, for a generated one, that it is AI-generated (the
 * FLUX licence asks for generated outputs to be disclosed wherever they are shown).
 */
export function characterAlt(character: Named) {
  const name = characterName(character);

  return character.origin === "upload" ? name : `${name}, AI-generated image`;
}

/** A storyboard's title, or whose it is when it has none. */
export function storyboardName(storyboard: { character: Named; title: string | null }) {
  return storyboard.title ?? `${characterName(storyboard.character)}'s storyboard`;
}
