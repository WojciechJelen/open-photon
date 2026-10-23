// Motion Transfer's public module: what other features may import from it
// (`scripts/check-import-boundaries.mjs`). Client-safe and loadable by Node: contracts, the draft
// (prefill, remix and "Animate this character" links, snapshots for generation actions), the
// composer's slot contracts and server-function types. The wizard owns its URL: another feature
// opens it on a draft with `draftHref`, never by holding its state. Slot components are mounted
// in `src/app/composer-slots.ts`; test fixtures are in `tests/fixtures.ts`.
//
// Carrying the draft through another page (the character library `/characters`, the builder
// `/characters/new`): a link there carries the shot in one search member, `draft`
// (`carryDraft(draft)`: `{ draft }`, a JSON object in the URL); the page decodes it with
// `draft: carriedDraft(search.draft)` in its `validateSearch` (validated like `parseDraft`,
// without step and character); "Animate" goes back with
// `draftHref(withCharacter(draft ?? {}, characterId))`, keeping the motion and the direction.
export type { SampleMotion } from "./contracts.ts";

export {
  carriedDraft,
  carryDraft,
  defaultDirection,
  type Direction,
  draftHref,
  type DraftSnapshot,
  type MotionTransferDraft,
  motionTransferDraftSchema,
  parseDraft,
  snapshotDraft,
  withCharacter,
  withSeed,
} from "./draft.ts";

export type { loadStudio } from "./selection.functions.ts";

export type {
  CharacterPickerProps,
  ComposerSlots,
  DirectGenerationActionsProps,
  DirectionEditorProps,
  ResultGenerationActionsProps,
} from "./slots.ts";

// Frozen props for other features' tests of their slot components and links.
export {
  directionFixture,
  draftFixture,
  sampleCharacterId,
  sampleMotionId,
  snapshotFixture,
} from "./tests/fixtures.ts";
