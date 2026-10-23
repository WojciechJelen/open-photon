// Frozen props for developing against Motion Transfer's composer without the wizard: a valid
// draft, its snapshot, and a direction, for a direction editor (`DirectionEditorProps`), a
// generation action (`DirectGenerationActionsProps`, `ResultGenerationActionsProps`) or a link
// (`draftHref`). Loadable by Node and by Playwright; other features import them from `api.ts`.
import {
  type Direction,
  type DraftSnapshot,
  type MotionTransferDraft,
  snapshotDraft,
} from "../draft.ts";

/**
 * Stands for the seeded sample character `arthur`
 * (`src/features/characters/samples/characters/manifest.json`).
 * Seeding gives every database its own random ids: a browser test takes the real one from the
 * database (`seededResult()` in `tests/e2e/session.ts`) or from the picker.
 */
export const sampleCharacterId = "5d0f6c1e-8a43-4f2b-9c7e-2b1a0d9e8f71";

/**
 * Stands for the clip of the seeded sample motion `street-dance` (`samples/motions/manifest.json`):
 * a draft's `motion` is the id of the video asset, not of the `motions` row. Random per database,
 * like `sampleCharacterId`.
 */
export const sampleMotionId = "a3e9b7d2-6c15-4e08-b4f3-7d2c9e1a5b60";

/** A direction as the Direct step's form holds it: a starter look, a seed. */
export const directionFixture: Direction = {
  prompt: "Background: a rooftop at golden hour.",
  seed: "7",
};

/** A draft on the Direct step with both picks and every direction field set. */
export const draftFixture: MotionTransferDraft = {
  step: "direct",
  motion: sampleMotionId,
  character: sampleCharacterId,
  prompt: directionFixture.prompt,
  seed: Number(directionFixture.seed),
};

/** `draftFixture` as generation actions get it. */
export const snapshotFixture: DraftSnapshot = snapshotDraft(draftFixture);
