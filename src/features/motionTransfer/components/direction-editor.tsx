import { FilmIcon, VideoIcon } from "lucide-react";
import { useId } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { Textarea } from "#/components/ui/textarea";
import { starters, toggleStarter } from "#/features/motionTransfer/look";
import type { DirectionEditorProps } from "#/features/motionTransfer/slots";
import { Viewfinder } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";

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
 * The Direct step's default direction editor (`DirectionEditorProps`): the camera angle (As
 * filmed, or a reshoot preset on its top-down diagram; Beta while the presets' phrasing is a
 * placeholder) and the look (appearance and background, up to 500 characters, with starter
 * chips).
 */
export function DefaultDirectionEditor({
  angles,
  errors,
  motionPreview,
  onChange,
  placeholderAngles,
  value,
}: DirectionEditorProps) {
  const id = useId();
  const { angle, prompt } = value;

  return (
    <>
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
          onValueChange={(next) => onChange({ ...value, angle: next })}
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
          onChange={(event) => onChange({ ...value, prompt: event.target.value })}
          placeholder="Keep the character and the background from the photo."
          value={prompt}
        />
        <div aria-label="Starters" className="flex flex-wrap gap-2" role="group">
          {starters.map((starter) => (
            <Button
              aria-pressed={prompt.includes(starter.phrase)}
              key={starter.label}
              onClick={() => onChange({ ...value, prompt: toggleStarter(prompt, starter.phrase) })}
              size="sm"
              type="button"
              variant="chip"
            >
              {starter.label}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}
