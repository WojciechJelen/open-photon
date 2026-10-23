import type { ComposerSlots } from "#/features/motionTransfer/api";
// The application's client composition of Motion Transfer's composer: the one place that decides
// which component fills each of its slots (`ComposerSlots`). The routes that render the composer
// (`/motionTransfer`, `/g/:id`) pass these on; a feature that replaces a slot (DEV-291's look
// controls, DEV-292's batch actions, DEV-293's library picker) exports its component from its
// public module and is mounted here, never inside the wizard, the Direct step or the result.
import { DefaultCharacterPicker } from "#/features/motionTransfer/components/character-step";
import { DefaultDirectionEditor } from "#/features/motionTransfer/components/direction-editor";
import {
  GenerateButton,
  RerunButton,
} from "#/features/motionTransfer/components/generation-actions";

export const composerSlots: ComposerSlots = {
  characterPicker: DefaultCharacterPicker,
  directGenerationActions: GenerateButton,
  directionEditor: DefaultDirectionEditor,
  resultGenerationActions: RerunButton,
};
