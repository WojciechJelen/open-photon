// The Motion Transfer composer's slots: the parts other features replace (DEV-291's look
// controls, DEV-292's batch actions, DEV-293's library picker). A slot is an ordinary React
// component, or a function where it only answers (`lookName`); which one fills each slot is
// decided in one place, `src/app/composer-slots.ts`, never inside the wizard. The wizard owns its
// URL (`/motionTransfer`): a slot or another page never holds its draft, and prefills it by
// linking there with `draftHref`.
import type { ComponentType, ReactNode } from "react";

import type { PickableCharacter } from "#/features/characters";
import type { ChildState } from "#/features/motionTransfer/components/render-ended";
import type { Direction, DraftSnapshot } from "#/features/motionTransfer/draft";
import type { Field } from "#/features/motionTransfer/use-generate";
import type { GenerationSnapshot } from "#/shared/contracts";
import type { HoldForCode } from "#/shared/use-access-code";

/**
 * The Character step's picker, between the step's intro and its photo tips: what the visitor
 * picks the performer from. The app mounts the characters feature's `LibraryCharacterPicker`.
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
  /**
   * The pickable characters the wizard's loader has: the library with a session, else the samples.
   */
  characters: PickableCharacter[];
  /**
   * The shot as it stands without its character: the motion, `from` and the direction, every
   * direction field explicit (`directionFields`), to carry to another page and back.
   */
  draft: DraftSnapshot;
  /** Runs an action that needs the access code once the visitor has one (an upload). */
  hold: HoldForCode;
  /** The section's number, on a page that counts its sections ("01"). */
  number?: string;
  /** Picks a character by id (`undefined` unpicks); a new upload is picked through it too. */
  onPick: (characterId: string | undefined) => void;
  /** Drops what `hold` keeps under `key` (a cancelled upload). */
  release: (key: string) => void;
  /** Whether the visitor has an access-code session. */
  signedIn: boolean;
  /** The section's heading, on a page that words it otherwise; "Character" when left out. */
  title?: string;
};

/**
 * The Direct step's direction editor, controlled: it shows `value` and reports every edit as the
 * whole next direction, which the wizard writes to its URL. The app mounts the looks feature's
 * `LookEditor` (a description, curated looks, and the prompt they compose).
 */
export type DirectionEditorProps = {
  /**
   * The picture of the character, for the look that keeps it as it is; `null` while it is locked.
   * Left out, as on a preset page, where the look is the preset's and not the photo's, the editor
   * offers no such look.
   */
  characterImage?: string | null;
  /** That picture's alt text: a generated character says so. */
  characterImageAlt?: string;
  /** The fields the last Generate found wrong, to mark as invalid. */
  errors: Field[];
  onChange: (next: Direction) => void;
  /**
   * The Direct step's seed field, for the editor to fold with what goes past the look's words and
   * background under an Advanced row. Left out, as on a preset page, which folds the editor whole
   * and shows its own seed, the editor folds nothing.
   */
  seedField?: ReactNode;
  value: Direction;
};

/**
 * The Direct step's generation actions, in the slate. The default is Generate (`GenerateButton`),
 * the submit button of the step's form (`formId`): submitting the form checks the choices, says
 * what is wrong, and starts the generation (`pending` until it answers).
 */
export type DirectGenerationActionsProps = {
  /** The shot as it stands, picks and direction; what the form holds invalid is left out. */
  draft: DraftSnapshot;
  formId: string;
  pending: boolean;
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
  /** What the slate calls a direction's prompt: the look's name, which only its editor can read. */
  lookName: (prompt: string) => string;
  resultGenerationActions: ComponentType<ResultGenerationActionsProps>;
};
