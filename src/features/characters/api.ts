/**
 * The characters feature's public server API: what other features' server code may import from
 * it (`scripts/check-import-boundaries.mjs`). Server-only; client code imports `index.ts`.
 *
 * Ownership policy: a workspace library. There is one workspace per installation, reached
 * through the access-code session; every character that is not a sample belongs to it and is
 * visible to whoever holds a session. There is no per-user owner. The sample characters
 * (`samples/characters/manifest.json`, seeded by `seedSampleCharacters`) are shown to anyone;
 * an uploaded likeness needs a session (`visibleCharacter`, `charactersAccess`).
 *
 * Every read and write returns a `CharacterSummary`; a refused operation throws `CharacterError`
 * with the HTTP status and `reason` to answer with.
 */
export {
  CharacterError,
  createFromGeneration,
  createFromUpload,
  getCharacter,
  listCharacters,
  listSampleCharacters,
  renameCharacter,
  setFavorite,
  visibleCharacter,
} from "./server/repository.ts";
