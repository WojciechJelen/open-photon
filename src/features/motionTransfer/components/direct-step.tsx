import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { type ComponentType, useId } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { StepIntro } from "#/features/motionTransfer/components/step-intro";
import type { AngleChoice } from "#/features/motionTransfer/contracts";
import type { Direction, MotionTransferDraft } from "#/features/motionTransfer/draft";
import type { DirectionEditorProps } from "#/features/motionTransfer/slots";
import { type Field, fieldMessages } from "#/features/motionTransfer/use-generate";
import type { Refusal } from "#/shared/requests";

/**
 * Step 3, direct the shot (optional): the direction editor (`directionEditor`, by default the
 * camera angle and the look: `DefaultDirectionEditor`), and the seed under Advanced. It is the
 * form Generate submits (`formId`); the generation actions live in the slate.
 */
export function DirectStep({
  angles,
  back,
  direction,
  directionEditor: DirectionEditor,
  errors,
  failure,
  formId,
  motionPreview,
  onChange,
  onSubmit,
  placeholderAngles,
}: {
  angles: AngleChoice[];
  back: MotionTransferDraft;
  direction: Direction;
  directionEditor: ComponentType<DirectionEditorProps>;
  errors: Field[];
  failure: Refusal | null;
  formId: string;
  motionPreview: string | null;
  onChange: (direction: Direction) => void;
  onSubmit: () => void;
  placeholderAngles: boolean;
}) {
  const id = useId();
  const { seed } = direction;

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
      <StepIntro
        back={{ label: "Character", search: back }}
        label="Step 3 of 4 · Optional"
        title="Direct the shot"
      >
        Keep it as filmed, or reshoot from a new angle and restyle the scene. Skip straight to
        Generate if you like it as it is.
      </StepIntro>

      <DirectionEditor
        angles={angles}
        errors={errors}
        motionPreview={motionPreview}
        onChange={onChange}
        placeholderAngles={placeholderAngles}
        value={direction}
      />

      <div className="rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1">
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button
              className="group flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              type="button"
            >
              <span className="inline-flex items-center gap-2.5 font-semibold">
                <SlidersHorizontalIcon aria-hidden="true" className="size-4.5" />
                Advanced
              </span>
              <span className="inline-flex items-center gap-2.5 text-sm text-soft-foreground">
                Seed: {seed.trim() === "" ? "default" : seed.trim()}
                <ChevronDownIcon
                  aria-hidden="true"
                  className="size-4 transition-transform group-aria-expanded:rotate-180"
                />
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-2 px-5 pb-5">
              <Label htmlFor={`${id}-seed`}>Seed</Label>
              <Input
                aria-describedby={`${id}-seed-hint`}
                aria-invalid={errors.includes("seed")}
                id={`${id}-seed`}
                inputMode="numeric"
                onChange={(event) => onChange({ ...direction, seed: event.target.value })}
                placeholder="Default"
                value={seed}
              />
              <p className="text-sm text-muted-foreground" id={`${id}-seed-hint`}>
                The same seed with the same choices gives the same video. Left blank, the seed is a
                fixed default; “Retry with a new seed” picks a random one.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {errors.length > 0 && (
        <ul
          aria-label="Problems with the form"
          className="flex flex-col gap-1 rounded-xl border border-destructive/40 bg-destructive/6 px-4 py-3 text-sm text-destructive-foreground"
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
          className="rounded-xl border border-destructive/40 bg-destructive/6 px-4 py-3 text-sm text-destructive-foreground"
          data-reason={failure.reason}
          role="alert"
        >
          {failure.message}
        </p>
      )}
    </form>
  );
}
