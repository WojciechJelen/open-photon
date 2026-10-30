// How the photoshoot pages name things: a character and a photoshoot. Client-safe.
import type { CharacterSummary } from "#/features/characters";
import { type PhotoshootSettingId, photoshootSetting } from "#/features/photoshoot/settings";

/** What the library calls a character: its title, or what it is. */
export function characterLabel(character: Pick<CharacterSummary, "origin" | "title">) {
  return (
    character.title ?? (character.origin === "upload" ? "Untitled photo" : "Untitled character")
  );
}

/** A photoshoot's name: who, and where. */
export function photoshootTitle(
  character: Pick<CharacterSummary, "origin" | "title"> | null,
  setting: PhotoshootSettingId,
) {
  const who = character ? characterLabel(character) : "A character";

  return `${who}, ${photoshootSetting(setting).title}`;
}
