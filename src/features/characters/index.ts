// The characters feature's public client module: its contracts, which other features' client code
// (and tests) may import (`scripts/check-import-boundaries.mjs`). Server code imports `api.ts`.
// Contracts only, so Node loads it as is; the composition (`src/app/composer-slots.ts`) mounts the
// library-backed picker, `components/library-character-picker.tsx`, in Motion Transfer's
// `characterPicker` slot.
export {
  type CharacterList,
  type CharacterListQuery,
  characterListQuerySchema,
  characterListSchema,
  type CharacterSummary,
  characterSchema,
  characterSummarySchema,
  characterTitleSchema,
  type PickableCharacter,
} from "./contracts.ts";
