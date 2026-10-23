// Motion Transfer's public module: what other features may import from it
// (`scripts/check-import-boundaries.mjs`). Client-safe and loadable by Node: contracts, the draft
// (prefill, remix and "Animate this character" links, snapshots for generation actions),
// server-function types, and test fixtures (`tests/fixtures.ts`).
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

// Frozen props for other features' tests of their slot components and links.
export {
  directionFixture,
  draftFixture,
  sampleCharacterId,
  sampleMotionId,
  snapshotFixture,
} from "./tests/fixtures.ts";
