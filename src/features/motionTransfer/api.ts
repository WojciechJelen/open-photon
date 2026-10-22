// Motion Transfer's public module: what other features may import from it
// (`scripts/check-import-boundaries.mjs`). Client-safe: contracts and server-function types only.
export type { PickableCharacter, SampleMotion } from "#/features/motionTransfer/contracts";

export type { loadStudio } from "#/features/motionTransfer/selection.functions";
