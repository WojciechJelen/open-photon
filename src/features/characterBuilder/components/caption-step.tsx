import { ArrowLeftIcon, RotateCcwIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";
import { useId } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { controlsOf } from "#/features/characterBuilder/builder-form";
import type { BuilderForm } from "#/features/characterBuilder/builder-memory";
import { Disclosure } from "#/features/characterBuilder/components/disclosure";
import {
  GenerationFailure,
  GenerationProgress,
} from "#/features/characterBuilder/components/generation-progress";
import { LoadFailure, StepSkeleton } from "#/features/characterBuilder/components/load-states";
import { StepHeading } from "#/features/characterBuilder/components/step-heading";
import { compileCharacterRequest } from "#/features/characterBuilder/contracts";
import {
  useFollowedGeneration,
  useStoredGeneration,
} from "#/features/characterBuilder/use-followed-generation";
import type { GenerationSnapshot } from "#/shared/contracts";
import { isFinished } from "#/shared/use-live-generation";

/** A field of the caption form the last Generate found wrong. */
export type CaptionField = "caption" | "seed";

const fieldMessages: Record<CaptionField, string> = {
  caption: "Write a caption of 1 to 4000 characters, not only spaces.",
  seed: `The seed is a whole number from 0 to ${Number.MAX_SAFE_INTEGER}.`,
};

/** What the caption screen does, as the page (`CharacterBuilder`) carries it out. */
export type CaptionActions = {
  /** Back to the description. */
  onBack: () => void;
  onChange: (next: BuilderForm) => void;
  /**
   * Enhance the description: the same description is the same request (the upsampler decodes
   * greedily, so it would write the same caption again); `fresh` sends a new one, for an
   * enhancement whose status is unknown.
   */
  onEnhance: (fresh: boolean) => void;
  /** Generate the image from exactly `caption`. */
  onGenerate: (caption: string) => void;
  /** The shared retry of a failed enhancement (a new seed). */
  onRetry: (generationId: string) => void;
  /** Ask for the access code, then carry on with `resume` (read the enhancement again). */
  onUnlock: (resume: () => void) => void;
};

type Props = CaptionActions & {
  captionId: string | undefined;
  errors: CaptionField[];
  form: BuilderForm;
  notice: React.ReactNode;
  pending: "enhance" | "generate" | "retry" | null;
};

const headingId = "builder-caption-title";

/**
 * Step 2: the caption FLUX 3 renders from. After an enhancement (`captionId`): its progress, or
 * why it failed and what to do, then the enhanced caption in an editable box, marked "Edited"
 * once it differs. Without one, a caption written by hand, which starts from the compiled
 * request. Generate sends the box's text exactly as it stands: nothing is trimmed or rewritten.
 */
export function CaptionStep(props: Props) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-7">
      <StepHeading id={headingId} label="Step 2 of 3" title="Review the caption">
        This is exactly what the image model reads. Edit anything; what you approve is what is sent.
      </StepHeading>
      {props.captionId ? (
        <StoredCaption {...props} captionId={props.captionId} key={props.captionId} />
      ) : (
        <CaptionEditor {...props} enhanced={null} />
      )}
    </section>
  );
}

function StoredCaption(props: Props & { captionId: string }) {
  const { loaded, reload } = useStoredGeneration(props.captionId);

  if (loaded.state === "loading") {
    return <StepSkeleton label="Loading the caption" />;
  }

  if (loaded.state === "refused") {
    return (
      <LoadFailure
        onBack={props.onBack}
        onReload={reload}
        onUnlock={() => props.onUnlock(reload)}
        refusal={loaded.refusal}
      />
    );
  }

  return <LiveCaption {...props} initial={loaded.generation} />;
}

function LiveCaption(props: Props & { initial: GenerationSnapshot }) {
  const { generation, output, providerUnavailable } = useFollowedGeneration(
    props.initial,
    "caption",
  );

  if (!isFinished(generation.status)) {
    return (
      <div className="flex flex-col gap-6">
        <GenerationProgress
          generation={generation}
          making="caption"
          providerUnavailable={providerUnavailable}
        />
        <p className="text-sm text-soft-foreground">
          Safe to leave or reload: the enhancement keeps going, and this page picks it up again.
        </p>
        <div>
          <BackButton onBack={props.onBack} />
        </div>
      </div>
    );
  }

  if (generation.status !== "done" || output?.media !== "text") {
    const retryable = generation.status === "failed" || generation.status === "cancelled";

    return (
      <GenerationFailure generation={generation} making="caption">
        {retryable ? (
          <Button
            disabled={props.pending !== null}
            onClick={() => props.onRetry(generation.id)}
            size="lg"
          >
            <RotateCcwIcon aria-hidden="true" />
            {props.pending === "retry" ? "Trying again…" : "Try again"}
          </Button>
        ) : (
          <Button disabled={props.pending !== null} onClick={() => props.onEnhance(true)} size="lg">
            <SparklesIcon aria-hidden="true" />
            Enhance again
          </Button>
        )}
        <Button onClick={props.onBack} size="lg" variant="outline">
          Edit the description
        </Button>
        {props.notice}
      </GenerationFailure>
    );
  }

  return <CaptionEditor {...props} enhanced={{ id: generation.id, text: output.text }} />;
}

function CaptionEditor({
  enhanced,
  errors,
  form,
  notice,
  onBack,
  onChange,
  onEnhance,
  onGenerate,
  pending,
}: Props & { enhanced: { id: string; text: string } | null }) {
  const id = useId();
  const captionFor = enhanced?.id ?? null;
  const edited = form.caption !== null && form.captionFor === captionFor;

  const start =
    enhanced?.text ?? compileCharacterRequest(form.description.trim(), controlsOf(form));

  const caption = edited ? (form.caption ?? start) : start;
  const changed = enhanced !== null && caption !== enhanced.text;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate(caption);
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={`${id}-caption`}>{enhanced ? "Enhanced caption" : "Your caption"}</Label>
          {enhanced ? (
            <Badge aria-live="polite" data-edited={changed} variant={changed ? "brand" : "default"}>
              {changed ? "Edited" : "As enhanced"}
            </Badge>
          ) : (
            <Badge>Written by you</Badge>
          )}
        </div>
        <Textarea
          aria-describedby={`${id}-caption-hint`}
          aria-invalid={errors.includes("caption")}
          rows={10}
          id={`${id}-caption`}
          maxLength={4000}
          onChange={(event) =>
            onChange({ ...form, caption: event.target.value, captionFor: captionFor })
          }
          spellCheck
          value={caption}
        />
        <p className="text-sm text-muted-foreground" id={`${id}-caption-hint`}>
          {caption.length} / 4000 ·{" "}
          {enhanced
            ? "Written by the FLUX 3 prompt upsampler from your description."
            : "Starts from your description and the full-body framing; write it the way you want it."}
        </p>
      </div>

      {(changed || !enhanced) && (
        <div className="flex flex-wrap gap-2.5">
          {changed && (
            <Button
              onClick={() => onChange({ ...form, caption: null, captionFor: null })}
              type="button"
              variant="ghost"
            >
              <RotateCcwIcon aria-hidden="true" />
              Back to the enhanced caption
            </Button>
          )}
          {!enhanced && (
            <Button
              disabled={pending !== null}
              onClick={() => onEnhance(false)}
              type="button"
              variant="ghost"
            >
              <SparklesIcon aria-hidden="true" />
              {pending === "enhance" ? "Enhancing…" : "Enhance it instead"}
            </Button>
          )}
        </div>
      )}

      <Disclosure
        summary={`Seed: ${form.seed.trim() === "" ? "random" : form.seed.trim()}`}
        title="Advanced"
      >
        <Label htmlFor={`${id}-seed`}>Seed</Label>
        <Input
          aria-describedby={`${id}-seed-hint`}
          aria-invalid={errors.includes("seed")}
          id={`${id}-seed`}
          inputMode="numeric"
          onChange={(event) => onChange({ ...form, seed: event.target.value })}
          placeholder="Random"
          value={form.seed}
        />
        <p className="text-sm text-muted-foreground" id={`${id}-seed-hint`}>
          The same caption and seed give the same image. Left blank, a random seed is picked once
          and shown with the result.
        </p>
      </Disclosure>

      {errors.length > 0 && (
        <ul
          aria-label="Problems with the caption"
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
        <Button disabled={pending !== null} size="lg" type="submit" variant="photon">
          <WandSparklesIcon aria-hidden="true" />
          {pending === "generate" ? "Starting…" : "Generate character"}
        </Button>
        <BackButton onBack={onBack} />
      </div>
    </form>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button onClick={onBack} size="lg" type="button" variant="ghost">
      <ArrowLeftIcon aria-hidden="true" />
      Edit the description
    </Button>
  );
}
