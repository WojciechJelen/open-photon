// The Motion Transfer composer's slots: the parts other features replace (DEV-291's look
// controls, DEV-292's batch actions). A slot is an ordinary React component; which one fills each
// slot is decided in one place, `src/app/composer-slots.ts`, never inside the wizard.
import type { ComponentType } from "react";

import type { ChildState } from "#/features/motionTransfer/components/render-ended";
import type { AngleChoice } from "#/features/motionTransfer/contracts";
import type { Direction, DraftSnapshot } from "#/features/motionTransfer/draft";
import type { Field } from "#/features/motionTransfer/use-generate";
import type { GenerationSnapshot } from "#/shared/contracts";

/**
 * The Direct step's direction editor, controlled: it shows `value` and reports every edit as the
 * whole next direction. The seed stays under the step's Advanced; the default edits the angle and
 * the look (`DefaultDirectionEditor`).
 */
export type DirectionEditorProps = {
  /** The reshoot presets on offer, besides `none` (As filmed). */
  angles: AngleChoice[];
  /** The fields the last Generate found wrong, to mark as invalid. */
  errors: Field[];
  /** The motion clip, for a preview; `null` while it is private to the visitor. */
  motionPreview: string | null;
  onChange: (next: Direction) => void;
  /** Whether the presets' phrasing is still a placeholder (shown as Beta). */
  placeholderAngles: boolean;
  value: Direction;
};

/**
 * The Direct step's generation actions, shown in the slate twice: beside the step from `lg`
 * (`panel`) and in the bar fixed to the bottom below it (`bar`). The default is Generate
 * (`GenerateButton`), the submit button of the step's form (`formId`): submitting the form checks
 * the choices, says what is wrong, and starts the generation (`pending` until it answers).
 */
export type DirectGenerationActionsProps = {
  /** The shot as it stands, picks and direction; what the form holds invalid is left out. */
  draft: DraftSnapshot;
  formId: string;
  pending: boolean;
  place: "bar" | "panel";
};

/**
 * A finished take's generation actions, in its recipe panel. The default is Re-run
 * (`RerunButton`), which calls `onRerun` and says how that went through `child`.
 */
export type ResultGenerationActionsProps = {
  child: ChildState;
  /** The take as a draft: its picks, its direction, and `from` it. */
  draft: DraftSnapshot;
  generation: GenerationSnapshot;
  onRerun: () => void;
};

/** What fills each slot, as `src/app/composer-slots.ts` composes it. */
export type ComposerSlots = {
  directGenerationActions: ComponentType<DirectGenerationActionsProps>;
  directionEditor: ComponentType<DirectionEditorProps>;
  resultGenerationActions: ComponentType<ResultGenerationActionsProps>;
};
