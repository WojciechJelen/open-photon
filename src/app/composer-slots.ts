// The application's client composition of Motion Transfer's composer: the one place that decides
// which component fills each of its slots (`ComposerSlots`). The routes that render the composer
// (`/motionTransfer`, `/g/:id`) pass these on; a feature that replaces a slot (DEV-291's look
// controls, DEV-292's batch actions, DEV-293's library picker) exports its component from its
// public module and is mounted here, never inside the wizard, the Direct step or the result. It
// also links the library to the builder (`createCharacterHref`), which neither feature assumes.
import { createElement } from "react";

import { BatchVariations } from "#/features/batches/components/batch-variations";
import { LibraryCharacterPicker } from "#/features/characters/components/library-character-picker";
import { type CreateCharacterHref, libraryHref } from "#/features/characters/library";
import type {
  CharacterPickerProps,
  ComposerSlots,
  DirectGenerationActionsProps,
  ResultGenerationActionsProps,
} from "#/features/motionTransfer/api";
import { DefaultDirectionEditor } from "#/features/motionTransfer/components/direction-editor";
import {
  GenerateButton,
  RerunButton,
} from "#/features/motionTransfer/components/generation-actions";

/**
 * Where "Describe a character" leads from the library (`/characters`) and the composer's picker:
 * the character builder, `/characters/new`, carrying the composer draft, which its "Use for
 * animation" brings back to the wizard.
 */
export const createCharacterHref: CreateCharacterHref = (draft) =>
  libraryHref("/characters/new", draft);

/** The library-backed picker, with its link to the builder. */
function CharacterPicker(props: CharacterPickerProps) {
  return createElement(LibraryCharacterPicker, { ...props, createCharacterHref });
}

/** Generate, with the batch variations of the same shot beside it. */
function DirectGenerationActions(props: DirectGenerationActionsProps) {
  return createElement(BatchVariations, {
    action: createElement(GenerateButton, props),
    draft: props.draft,
    place: props.place,
  });
}

/** Re-run, with the batch variations of the take beside it. */
function ResultGenerationActions(props: ResultGenerationActionsProps) {
  return createElement(BatchVariations, {
    action: createElement(RerunButton, props),
    draft: props.draft,
    place: "result",
  });
}

export const composerSlots: ComposerSlots = {
  characterPicker: CharacterPicker,
  directGenerationActions: DirectGenerationActions,
  directionEditor: DefaultDirectionEditor,
  resultGenerationActions: ResultGenerationActions,
};
