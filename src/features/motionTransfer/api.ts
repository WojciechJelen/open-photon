// Motion Transfer's public module: what other features may import from it
// (`scripts/check-import-boundaries.mjs`). Client-safe and loadable by Node: contracts, the draft
// (prefill, remix and "Animate this character" links, snapshots for generation actions), the
// composer's slot contracts and server-function types. Slot components are mounted in
// `src/app/composer-slots.ts`; test fixtures are in `tests/fixtures.ts`.
export type { PickableCharacter, SampleMotion } from "./contracts.ts";

export {
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
