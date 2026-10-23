import { ArrowLeftIcon, RotateCcwIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";
import { useEffect, useId } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { type ImageRecipe, readImageRecipe } from "#/features/characterBuilder/builder-client";
import {
  type CaptionSource,
  controlsOf,
  manualBasis,
  seedOf,
  withDescribed,
  writtenSource,
} from "#/features/characterBuilder/builder-form";
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
  useStored,
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
  /** Enhance the description as it stands (the same description is the same request). */
  onEnhance: () => void;
  /** Generate the image from exactly `caption`, from `source`. */
  onGenerate: (caption: string, source: CaptionSource) => void;
  /** A new enhancement of the one `captionId` made (failed or cancelled). */
  onTryAgain: (captionId: string) => void;
  /** Back to the image the caption editor was opened from. */
  onOpenImage: () => void;
  /** Ask for the access code, then carry on with `resume` (read again what could not be read). */
  onUnlock: (resume: () => void) => void;
};

type Props = CaptionActions & {
  /** A caption enhancement to review. */
  captionId: string | undefined;
  errors: CaptionField[];
  form: BuilderForm;
  /** An image whose caption to edit: its own caption, source and seed. */
  imageId: string | undefined;
  notice: React.ReactNode;
  pending: string | null;
};

const headingId = "builder-caption-title";

/**
 * Step 2: the caption FLUX 3 renders from, in one of three editors, each with its own edits
 * (`BuilderForm.captionFor`, the editor's basis):
 * - an image's caption (`imageId`): exactly the caption, source and seed it was made with;
 * - an enhancement (`captionId`): its progress, or why it failed, then the enhanced caption;
 * - a caption written by hand, which starts from the compiled request of the description and
 *   controls as they stand, and belongs to them.
 * Generate sends the box's text exactly as it stands: nothing is trimmed or rewritten.
 */
export function CaptionStep(props: Props) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-7">
      <StepHeading id={headingId} label="Step 2 of 3" title="Review the caption">
        This is exactly what the image model reads. Edit anything; what you approve is what is sent.
      </StepHeading>
      {props.imageId ? (
        <ImageCaption {...props} imageId={props.imageId} key={props.imageId} />
      ) : props.captionId ? (
        <StoredCaption {...props} captionId={props.captionId} key={props.captionId} />
      ) : (
        <CaptionEditor
          {...props}
          basis={manualBasis(props.form)}
          enhanced={null}
          source={writtenSource({
            controls: controlsOf(props.form),
            description: props.form.description,
          })}
          start={compileCharacterRequest(props.form.description.trim(), controlsOf(props.form))}
        />
      )}
    </section>
  );
}

/** Where an image's caption came from, as a new request for it names it. */
export function imageSource({ source }: ImageRecipe): CaptionSource {
  return source.enhancement
    ? { caption_generation_id: source.enhancement.generation_id }
    : writtenSource(source);
}

function ImageCaption(props: Props & { imageId: string }) {
  const { loaded, reload } = useStored(props.imageId, readImageRecipe);
  const basis = `image:${props.imageId}`;
  const { form, onChange } = props;
  const recipe = loaded.state === "ready" ? loaded.data : null;

  // Opened for this image (and not edited since): its description, controls and seed. Edits
  // made to this image's caption before are kept; anything else in the form is not its.
  useEffect(() => {
    if (recipe && form.captionFor !== basis) {
      onChange({
        ...withDescribed(form, recipe.source),
        caption: null,
        captionFor: basis,
        seed: String(recipe.seed),
      });
    }
  }, [recipe, form, basis, onChange]);

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

  if (!recipe || form.captionFor !== basis) {
    return <StepSkeleton label="Loading the caption" />;
  }

  const { enhancement } = recipe.source;

  return (
    <CaptionEditor
      {...props}
      basis={basis}
      enhanced={enhancement ? enhancement.caption : null}
      // The image's own caption and seed unchanged are the request that made it: never sent
      // again (Comfy may still have it, if its status is unknown); the image is shown instead.
      onGenerate={(caption, source) =>
        caption === recipe.caption && seedOf(form) === recipe.seed
          ? props.onOpenImage()
          : props.onGenerate(caption, source)
      }
      source={imageSource(recipe)}
      start={recipe.caption}
    />
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

  return <LiveCaption {...props} initial={loaded.data} />;
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
    return (
      <GenerationFailure
        generation={generation}
        making="caption"
        onTryAgain={() => props.onTryAgain(generation.id)}
        pending={props.pending}
      >
        <Button onClick={props.onBack} size="lg" variant="outline">
          Edit the description
        </Button>
        {props.notice}
      </GenerationFailure>
    );
  }

  return (
    <CaptionEditor
      {...props}
      basis={`caption:${generation.id}`}
      enhanced={output.text}
      source={{ caption_generation_id: generation.id }}
      start={output.text}
    />
  );
}

/**
 * The caption box of one basis: `start` until it is edited (edits are kept under `basis`), the
 * enhanced caption it came from (`enhanced`, to mark it "Edited" and go back to it), and where
 * it came from (`source`), which Generate sends with it.
 */
function CaptionEditor({
  basis,
  enhanced,
  errors,
  form,
  notice,
  onBack,
  onChange,
  onEnhance,
  onGenerate,
  pending,
  source,
  start,
}: Props & {
  basis: string;
  enhanced: string | null;
  source: CaptionSource;
  start: string;
}) {
  const id = useId();
  const caption = form.captionFor === basis && form.caption !== null ? form.caption : start;
  const changed = enhanced !== null && caption !== enhanced;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate(caption, source);
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={`${id}-caption`}>
            {enhanced === null ? "Your caption" : "Enhanced caption"}
          </Label>
          {enhanced === null ? (
            <Badge>Written by you</Badge>
          ) : (
            <Badge aria-live="polite" data-edited={changed} variant={changed ? "brand" : "default"}>
              {changed ? "Edited" : "As enhanced"}
            </Badge>
          )}
        </div>
        <Textarea
          aria-describedby={`${id}-caption-hint`}
          aria-invalid={errors.includes("caption")}
          id={`${id}-caption`}
          maxLength={4000}
          onChange={(event) =>
            onChange({ ...form, caption: event.target.value, captionFor: basis })
          }
          rows={10}
          spellCheck
          value={caption}
        />
        <p className="text-sm text-muted-foreground" id={`${id}-caption-hint`}>
          {caption.length} / 4000 ·{" "}
          {enhanced === null
            ? "Starts from your description and the full-body framing; write it the way you want it."
            : "Written by the FLUX 3 prompt upsampler from your description."}
        </p>
      </div>

      {(changed || enhanced === null) && (
        <div className="flex flex-wrap gap-2.5">
          {enhanced !== null && changed && (
            <Button
              onClick={() => onChange({ ...form, caption: enhanced, captionFor: basis })}
              type="button"
              variant="ghost"
            >
              <RotateCcwIcon aria-hidden="true" />
              Back to the enhanced caption
            </Button>
          )}
          {enhanced === null && (
            <Button disabled={pending !== null} onClick={onEnhance} type="button" variant="ghost">
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
