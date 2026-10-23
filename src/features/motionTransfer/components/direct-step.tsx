import { ChevronDownIcon, FilmIcon, SlidersHorizontalIcon, VideoIcon } from "lucide-react";
import { useId } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { Textarea } from "#/components/ui/textarea";
import { StepIntro } from "#/features/motionTransfer/components/step-intro";
import type { AngleChoice } from "#/features/motionTransfer/contracts";
import type { Direction, MotionTransferDraft } from "#/features/motionTransfer/draft";
import { starters, toggleStarter } from "#/features/motionTransfer/look";
import { type Field, fieldMessages } from "#/features/motionTransfer/use-generate";
import { Viewfinder } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import type { Refusal } from "#/shared/requests";

/** Where each preset's camera stands on the top-down diagram, around the performer at 80,44. */
const cameraPositions = new Map([
  ["front", { cx: 80, cy: 78 }],
  ["three-quarter", { cx: 104, cy: 68 }],
  ["profile", { cx: 114, cy: 44 }],
]);

const angleHints = new Map([
  ["none", "Keep the camera of your clip."],
  ["front", "The camera faces them straight on."],
  ["three-quarter", "Turned 45° to their side."],
  ["profile", "The camera sees them from the side."],
]);

const MAX_LOOK = 500;

/** A top-down camera diagram: the performer in the middle (facing down), the camera on the ring. */
function CameraDiagram({ cx, cy }: { cx: number; cy: number }) {
  return (
    <svg aria-hidden="true" className="h-24 w-full" viewBox="0 0 160 96">
      <circle
        className="stroke-foreground/12"
        cx="80"
        cy="44"
        fill="none"
        r="34"
        strokeDasharray="3 4"
      />
      <line
        className="stroke-brand"
        strokeDasharray="3 3"
        strokeWidth="1.5"
        x1={cx}
        x2="80"
        y1={cy}
        y2="44"
      />
      <circle
        className="fill-muted stroke-soft-foreground"
        cx="80"
        cy="44"
        r="11"
        strokeWidth="1.5"
      />
      <path
        className="stroke-soft-foreground"
        d="M74 52 L80 58 L86 52"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <circle className="fill-brand" cx={cx} cy={cy} r="8" />
      <circle className="fill-background" cx={cx} cy={cy} r="3" />
    </svg>
  );
}

/** One angle option: the whole card is the radio's label, so it selects from anywhere on it. */
function AngleCard({
  diagram,
  id,
  label,
}: {
  diagram: React.ReactNode;
  id: string;
  label: string;
}) {
  const inputId = `angle-${id}`;

  return (
    <label
      className="relative flex cursor-pointer flex-col gap-3 rounded-2xl border bg-foreground/2 p-3.5 transition-colors hover:border-edge-strong has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ring has-aria-checked:border-brand/85 has-aria-checked:bg-brand/8 has-aria-checked:ring-4 has-aria-checked:ring-brand/12"
      htmlFor={inputId}
    >
      <span className="relative block h-24 overflow-hidden rounded-lg border border-foreground/6 bg-foreground/3">
        {diagram}
      </span>
      <span className="flex items-start justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{label}</span>
          <span className="text-sm text-soft-foreground">
            {angleHints.get(id) ?? "A reshoot preset."}
          </span>
        </span>
        <RadioGroupItem id={inputId} value={id} />
      </span>
    </label>
  );
}

/**
 * Step 3, direct the shot (optional): the camera angle (As filmed, or a reshoot preset on its
 * top-down diagram; Beta while the presets' phrasing is a placeholder), the look (appearance and
 * background, up to 500 characters, with starter chips), and the seed under Advanced. It is the
 * form Generate submits (`formId`); the button lives in the slate.
 */
export function DirectStep({
  angles,
  back,
  direction,
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
  errors: Field[];
  failure: Refusal | null;
  formId: string;
  motionPreview: string | null;
  onChange: (direction: Direction) => void;
  onSubmit: () => void;
  placeholderAngles: boolean;
}) {
  const id = useId();
  const { angle, prompt, seed } = direction;

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

      <section aria-labelledby={`${id}-angle`} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-xl font-semibold" id={`${id}-angle`}>
            Camera angle
          </h2>
          {placeholderAngles && <Badge variant="brand">Beta</Badge>}
        </div>
        <RadioGroup
          aria-labelledby={`${id}-angle`}
          layout="cards"
          onValueChange={(value) => onChange({ ...direction, angle: value })}
          value={angle}
        >
          <AngleCard
            diagram={
              motionPreview ? (
                <>
                  <ClipStill className="opacity-55" src={motionPreview} />
                  <Viewfinder className="inset-2.5" />
                </>
              ) : (
                <span className="absolute inset-0 grid place-items-center text-muted-foreground">
                  <FilmIcon aria-hidden="true" className="size-7" />
                </span>
              )
            }
            id="none"
            label="As filmed"
          />
          {angles.map((choice) => {
            const position = cameraPositions.get(choice.id);

            return (
              <AngleCard
                diagram={
                  position ? (
                    <CameraDiagram cx={position.cx} cy={position.cy} />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-muted-foreground">
                      <VideoIcon aria-hidden="true" className="size-7" />
                    </span>
                  )
                }
                id={choice.id}
                key={choice.id}
                label={choice.label}
              />
            );
          })}
        </RadioGroup>
        {placeholderAngles && (
          <p className="text-sm text-muted-foreground">
            Beta: the angle phrasings are placeholders until the angle benchmark has picked them.
          </p>
        )}
      </section>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <label className="font-display text-xl font-semibold" htmlFor={`${id}-look`}>
            Look{" "}
            <span className="font-sans text-sm font-normal text-muted-foreground">
              · appearance and background, optional
            </span>
          </label>
          <span
            className={
              prompt.length > MAX_LOOK
                ? "hud text-destructive-foreground"
                : "hud text-muted-foreground"
            }
            id={`${id}-count`}
          >
            {prompt.length} / {MAX_LOOK}
          </span>
        </div>
        <Textarea
          aria-describedby={`${id}-count`}
          aria-invalid={errors.includes("prompt")}
          id={`${id}-look`}
          onChange={(event) => onChange({ ...direction, prompt: event.target.value })}
          placeholder="Keep the character and the background from the photo."
          value={prompt}
        />
        <div aria-label="Starters" className="flex flex-wrap gap-2" role="group">
          {starters.map((starter) => (
            <Button
              aria-pressed={prompt.includes(starter.phrase)}
              key={starter.label}
              onClick={() =>
                onChange({ ...direction, prompt: toggleStarter(prompt, starter.phrase) })
              }
              size="sm"
              type="button"
              variant="chip"
            >
              {starter.label}
            </Button>
          ))}
        </div>
      </div>

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
