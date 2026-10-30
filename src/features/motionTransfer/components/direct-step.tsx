import { type ComponentType, useId } from "react";

import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import type { Direction } from "#/features/motionTransfer/draft";
import type { DirectionEditorProps } from "#/features/motionTransfer/slots";
import { type Field, fieldMessages } from "#/features/motionTransfer/use-generate";
import type { Refusal } from "#/shared/requests";

/**
 * What stopped Generate, for the slate to show under the button: the Advanced row can hold the end
 * of the form far below the fold.
 */
export function GenerateProblems({
  errors,
  failure,
}: {
  errors: Field[];
  failure: Refusal | null;
}) {
  return (
    <>
      {errors.length > 0 && (
        <ul
          aria-label="Problems with the form"
          className="flex flex-col gap-1 rounded-field border border-destructive/40 bg-destructive/6 px-4 py-3 type-caption wrap-anywhere text-destructive-foreground"
          role="alert"
        >
          {errors.map((field) => (
            <li key={field}>{fieldMessages[field]}</li>
          ))}
        </ul>
      )}
      {failure && (
        <p
          aria-label="Not started"
          className="rounded-field border border-destructive/40 bg-destructive/6 px-4 py-3 type-caption wrap-anywhere text-destructive-foreground"
          data-reason={failure.reason}
          role="alert"
        >
          {failure.message}
        </p>
      )}
    </>
  );
}

/**
 * Step 3, direct the shot (optional): the direction editor (`directionEditor`, the looks
 * feature's `LookEditor` in the app), which folds the seed under its Advanced row. It is the form
 * Generate submits (`formId`); the generation actions live in the slate.
 */
export function DirectStep({
  characterImage,
  characterImageAlt,
  direction,
  directionEditor: DirectionEditor,
  errors,
  formId,
  onChange,
  onSubmit,
}: {
  characterImage: string | null;
  characterImageAlt: string;
  direction: Direction;
  directionEditor: ComponentType<DirectionEditorProps>;
  errors: Field[];
  formId: string;
  onChange: (direction: Direction) => void;
  onSubmit: () => void;
}) {
  const id = useId();

  return (
    <form
      className="flex flex-col gap-9"
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <DirectionEditor
        characterImage={characterImage}
        characterImageAlt={characterImageAlt}
        errors={errors}
        onChange={onChange}
        seedField={
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-seed`}>Seed</Label>
            <Input
              aria-describedby={`${id}-seed-hint`}
              aria-invalid={errors.includes("seed")}
              id={`${id}-seed`}
              inputMode="numeric"
              onChange={(event) => onChange({ ...direction, seed: event.target.value })}
              placeholder="Default"
              value={direction.seed}
            />
            <p className="type-hint wrap-anywhere text-muted-foreground" id={`${id}-seed-hint`}>
              The same seed with the same choices gives the same video. Left blank, the seed is a
              fixed default; “Retry with a new seed” picks a random one.
            </p>
          </div>
        }
        value={direction}
      />
    </form>
  );
}
