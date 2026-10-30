import { ListTreeIcon, SparklesIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { controlsOf, styleLabels, styleSamples } from "#/features/characterBuilder/builder-form";
import type { BuilderForm } from "#/features/characterBuilder/builder-memory";
import { Disclosure } from "#/features/characterBuilder/components/disclosure";
import { StepHeading } from "#/features/characterBuilder/components/step-heading";
import { characterStyles, compileCharacterRequest } from "#/features/characterBuilder/contracts";
import type { PickableCharacter } from "#/features/characters";
import { PictureTile } from "#/shared/components/picture-tile";
import { StableText } from "#/shared/components/stable-text";
import { ToolSection } from "#/shared/components/tool-layout";
import { mediaUrl } from "#/shared/media";

/** A field of the Describe form the last Enhance found wrong. */
export type DescribeField = "appearance" | "description" | "outfit";

const fieldMessages: Record<DescribeField, string> = {
  appearance: "Keep the appearance under 200 characters.",
  description: "Describe the character in 1 to 1000 characters.",
  outfit: "Keep the outfit under 200 characters.",
};

/**
 * Step 1: who the character is. A free description, optional appearance, outfit and style (each
 * style shown by the sample `samples` holds for it), and, on demand, exactly what the enhancement is
 * asked (`compileCharacterRequest`, the request the server compiles again from the same fields).
 * Enhance writes a full prompt from it; "Write the prompt myself" skips that. What went wrong shows
 * beside the actions and under them, where it moves nothing.
 */
export function DescribeStep({
  errors,
  form,
  notice,
  onChange,
  onEnhance,
  onWriteOwn,
  pending,
  samples,
}: {
  errors: DescribeField[];
  form: BuilderForm;
  notice: React.ReactNode;
  onChange: (next: BuilderForm) => void;
  onEnhance: () => void;
  onWriteOwn: () => void;
  pending: boolean;
  samples: PickableCharacter[];
}) {
  const id = useId();
  const compiled = compileCharacterRequest(form.description.trim(), controlsOf(form));

  return (
    <form
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onEnhance();
      }}
    >
      <StepHeading id={`${id}-title`} title="Describe your character">
        Who they are and how they look.
      </StepHeading>

      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea
          aria-invalid={errors.includes("description")}
          rows={3}
          id={`${id}-description`}
          maxLength={1000}
          onChange={(event) => onChange({ ...form, description: event.target.value })}
          value={form.description}
        />
      </div>

      <div className="grid grid-fit-65 gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${id}-appearance`}>Appearance</Label>
          <Input
            aria-invalid={errors.includes("appearance")}
            id={`${id}-appearance`}
            maxLength={200}
            onChange={(event) => onChange({ ...form, appearance: event.target.value })}
            placeholder="Optional"
            value={form.appearance}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${id}-outfit`}>Outfit</Label>
          <Input
            aria-invalid={errors.includes("outfit")}
            id={`${id}-outfit`}
            maxLength={200}
            onChange={(event) => onChange({ ...form, outfit: event.target.value })}
            placeholder="Optional"
            value={form.outfit}
          />
        </div>
      </div>

      <ToolSection title="Style">
        <div aria-label="Style" className="grid tiles-fit-32 gap-3.5" role="group">
          {characterStyles.map((style) => {
            const sample = samples.find(({ slug }) => slug === styleSamples[style]);

            return (
              <PictureTile
                alt=""
                aspect="aspect-square"
                caption={styleLabels[style]}
                key={style}
                onClick={() => onChange({ ...form, style: form.style === style ? null : style })}
                position="origin-top scale-160 object-top"
                pressed={form.style === style}
                ringOnly
                src={sample && mediaUrl(sample.image)}
              />
            );
          })}
        </div>
      </ToolSection>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button disabled={pending} type="submit">
          <SparklesIcon aria-hidden="true" />
          <StableText
            current={pending ? "Enhancing…" : "Enhance description"}
            labels={["Enhance description", "Enhancing…"]}
          />
        </Button>
        <Button disabled={pending} onClick={onWriteOwn} type="button" variant="ghost">
          Write the prompt myself
        </Button>
        {errors.length > 0 && (
          <ul
            aria-label="Problems with the description"
            className="min-w-0 flex-1 basis-60 type-caption text-destructive-foreground"
            role="alert"
          >
            {errors.map((field) => (
              <li key={field}>{fieldMessages[field]}</li>
            ))}
          </ul>
        )}
      </div>

      <Disclosure
        icon={<ListTreeIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
        title="What will be sent"
      >
        <p className="type-caption text-muted-foreground">
          The enhancement is asked to write a prompt from this. The server builds it again from your
          fields.
        </p>
        <output
          aria-label="Compiled request"
          className="rounded-field border bg-field px-3.5 py-3 type-caption wrap-anywhere whitespace-pre-wrap text-soft-foreground"
        >
          {compiled}
        </output>
      </Disclosure>

      {notice}
    </form>
  );
}
