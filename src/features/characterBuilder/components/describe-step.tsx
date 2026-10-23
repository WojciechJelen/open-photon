import { PenLineIcon, SparklesIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { controlsOf, styleLabels } from "#/features/characterBuilder/builder-form";
import type { BuilderForm } from "#/features/characterBuilder/builder-memory";
import { Disclosure } from "#/features/characterBuilder/components/disclosure";
import { StepHeading } from "#/features/characterBuilder/components/step-heading";
import { characterStyles, compileCharacterRequest } from "#/features/characterBuilder/contracts";

/** A field of the Describe form the last Enhance found wrong. */
export type DescribeField = "appearance" | "description" | "outfit";

const fieldMessages: Record<DescribeField, string> = {
  appearance: "Keep the appearance under 200 characters.",
  description: "Describe the character in 1 to 1000 characters.",
  outfit: "Keep the outfit under 200 characters.",
};

/**
 * Step 1: who the character is. A free description, optional appearance, outfit and style, and,
 * on demand, exactly what the enhancement is asked (`compileCharacterRequest`, the request the
 * server compiles again from the same fields). Enhance writes a full caption from it; "Write the
 * caption myself" skips that.
 */
export function DescribeStep({
  errors,
  form,
  notice,
  onChange,
  onEnhance,
  onWriteOwn,
  pending,
}: {
  errors: DescribeField[];
  form: BuilderForm;
  notice: React.ReactNode;
  onChange: (next: BuilderForm) => void;
  onEnhance: () => void;
  onWriteOwn: () => void;
  pending: boolean;
}) {
  const id = useId();
  const compiled = compileCharacterRequest(form.description.trim(), controlsOf(form));

  return (
    <form
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-7"
      onSubmit={(event) => {
        event.preventDefault();
        onEnhance();
      }}
    >
      <StepHeading id={`${id}-title`} label="Step 1 of 3" title="Describe your character">
        Who they are and how they look. The enhancement turns it into a detailed, full-body caption
        you can edit before anything is rendered.
      </StepHeading>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea
          aria-describedby={`${id}-description-count`}
          aria-invalid={errors.includes("description")}
          rows={5}
          id={`${id}-description`}
          maxLength={1000}
          onChange={(event) => onChange({ ...form, description: event.target.value })}
          placeholder="A retired lighthouse keeper in her sixties, weathered and cheerful, with a silver braid."
          value={form.description}
        />
        <p className="text-sm text-muted-foreground" id={`${id}-description-count`}>
          {form.description.length} / 1000
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-appearance`}>Appearance (optional)</Label>
          <Input
            aria-invalid={errors.includes("appearance")}
            id={`${id}-appearance`}
            maxLength={200}
            onChange={(event) => onChange({ ...form, appearance: event.target.value })}
            placeholder="Freckles, tall, short grey hair"
            value={form.appearance}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-outfit`}>Outfit (optional)</Label>
          <Input
            aria-invalid={errors.includes("outfit")}
            id={`${id}-outfit`}
            maxLength={200}
            onChange={(event) => onChange({ ...form, outfit: event.target.value })}
            placeholder="Yellow raincoat, rubber boots"
            value={form.outfit}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Style (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {characterStyles.map((style) => (
            <Button
              aria-pressed={form.style === style}
              key={style}
              onClick={() => onChange({ ...form, style: form.style === style ? null : style })}
              size="sm"
              type="button"
              variant="chip"
            >
              {styleLabels[style]}
            </Button>
          ))}
        </div>
      </fieldset>

      <Disclosure summary="Read-only" title="What will be sent">
        <p className="text-sm text-muted-foreground">
          The enhancement is asked to write a caption from this. The server builds it again from
          your fields.
        </p>
        <output
          aria-label="Compiled request"
          className="rounded-xl border bg-background/60 px-4 py-3 text-sm whitespace-pre-wrap text-soft-foreground"
        >
          {compiled}
        </output>
      </Disclosure>

      {errors.length > 0 && (
        <ul
          aria-label="Problems with the description"
          className="flex flex-col gap-1 rounded-xl border border-destructive/40 bg-destructive/6 px-4 py-3 text-sm text-destructive-foreground"
          role="alert"
        >
          {errors.map((field) => (
            <li key={field}>{fieldMessages[field]}</li>
          ))}
        </ul>
      )}
      {notice}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
        <Button disabled={pending} size="lg" type="submit" variant="photon">
          <SparklesIcon aria-hidden="true" />
          {pending ? "Enhancing…" : "Enhance caption"}
        </Button>
        <Button disabled={pending} onClick={onWriteOwn} size="lg" type="button" variant="outline">
          <PenLineIcon aria-hidden="true" />
          Write the caption myself
        </Button>
      </div>
    </form>
  );
}
