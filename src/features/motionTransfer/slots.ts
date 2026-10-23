// The Motion Transfer composer's slots: the parts other features replace (DEV-291's look
// controls, DEV-292's batch actions, DEV-293's library picker). A slot is an ordinary React
// component; which one fills each slot is decided in one place, `src/app/composer-slots.ts`,
// never inside the wizard. The wizard owns its URL (`/motionTransfer`): a slot or another page
// never holds its draft, and prefills it by linking there with `draftHref`.
import type { ComponentType } from "react";

import type { PickableCharacter } from "#/features/characters";
import type { ChildState } from "#/features/motionTransfer/components/render-ended";
import type { Direction, DraftSnapshot } from "#/features/motionTransfer/draft";
import type { Field } from "#/features/motionTransfer/use-generate";
import type { GenerationSnapshot } from "#/shared/contracts";
import type { HoldForCode } from "#/shared/use-access-code";

/**
 * The Character step's picker, between the step's intro and its photo tips: what the visitor
 * picks the performer from. The default (`DefaultCharacterPicker`) is the photo upload tile, the
 * visitor's own photo the URL names, and the sample characters.
 *
 * A picker that sends the visitor elsewhere to choose (the library at `/characters`, the builder
 * at `/characters/new`) carries `draft` there in the search (`carryDraft(draft)`, the one member
 * `draft`), and the page sends them back with `draftHref(withCharacter(draft ?? {}, id))`, which
 * keeps the motion and the direction (`carriedDraft`).
 */
export type CharacterPickerProps = {
  /** The character the URL names, as the visitor may see it; `null` without one, or locked. */
  character: PickableCharacter | null;
  /** The id of the character picked, whether or not the visitor may see it. */
  characterId: string | undefined;
  /** The pickable characters the wizard's loader has: the sample characters. */
  characters: PickableCharacter[];
  /**
   * The shot as it stands without its character: the motion, `from` and the direction, every
   * direction field explicit (`directionFields`), to carry to another page and back.
   */
  draft: DraftSnapshot;
  /** Runs an action that needs the access code once the visitor has one (an upload). */
  hold: HoldForCode;
  /** Picks a character by id (`undefined` unpicks); a new upload is picked through it too. */
  onPick: (characterId: string | undefined) => void;
  /** Drops what `hold` keeps under `key` (a cancelled upload). */
  release: (key: string) => void;
  /** Whether the visitor has an access-code session. */
  signedIn: boolean;
};

/**
 * The Direct step's direction editor, controlled: it shows `value` and reports every edit as the
 * whole next direction. The seed stays under the step's Advanced; the default edits the look
 * (`DefaultDirectionEditor`).
 */
export type DirectionEditorProps = {
  /** The fields the last Generate found wrong, to mark as invalid. */
  errors: Field[];
  onChange: (next: Direction) => void;
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
  characterPicker: ComponentType<CharacterPickerProps>;
  directGenerationActions: ComponentType<DirectGenerationActionsProps>;
  directionEditor: ComponentType<DirectionEditorProps>;
  resultGenerationActions: ComponentType<ResultGenerationActionsProps>;
};
