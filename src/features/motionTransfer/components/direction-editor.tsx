import { useId } from "react";

import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { starters, toggleStarter } from "#/features/motionTransfer/look";
import type { DirectionEditorProps } from "#/features/motionTransfer/slots";

const MAX_LOOK = 500;

/**
 * The Direct step's default direction editor (`DirectionEditorProps`): the look (appearance and
 * background, up to 500 characters, with starter chips).
 */
export function DefaultDirectionEditor({ errors, onChange, value }: DirectionEditorProps) {
  const id = useId();
  const { prompt } = value;

  return (
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
  );
}
