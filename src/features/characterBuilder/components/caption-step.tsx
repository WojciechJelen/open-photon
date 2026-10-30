import { ArrowLeftIcon, SlidersHorizontalIcon, SparklesIcon } from "lucide-react";
import { useEffect, useId } from "react";

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
import { LoadFailure } from "#/features/characterBuilder/components/load-states";
import { StepHeading } from "#/features/characterBuilder/components/step-heading";
import { compileCharacterRequest } from "#/features/characterBuilder/contracts";
import {
  useFollowedGeneration,
  useStored,
  useStoredGeneration,
} from "#/features/characterBuilder/use-followed-generation";
import { StableText } from "#/shared/components/stable-text";
import type { GenerationSnapshot } from "#/shared/contracts";
import { isFinished } from "#/shared/use-live-generation";

/** A field of the caption form the last Generate found wrong. */
export type CaptionField = "caption" | "seed";

const fieldMessages: Record<CaptionField, string> = {
  caption: "Write a prompt of 1 to 4000 characters, not only spaces.",
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
 * Step 2: the prompt FLUX 3 renders from, in one of three editors, each with its own edits
 * (`BuilderForm.captionFor`, the editor's basis):
 * - an image's caption (`imageId`): exactly the caption, source and seed it was made with;
 * - an enhancement (`captionId`): its progress, or why it failed, then the enhanced caption;
 * - a caption written by hand, which starts from the compiled request of the description and
 *   controls as they stand, and belongs to them.
 * Generate sends the box's text exactly as it stands: nothing is trimmed or rewritten. All of them
 * are one frame (`RefineForm`): progress and loading take the box the prompt will fill.
 */
export function CaptionStep(props: Props) {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-6">
      <StepHeading id={headingId} title="Refine the prompt">
        Change anything you like, then generate.
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
    return <LoadingForm {...props} />;
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
    return <LoadingForm {...props} />;
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
      <RefineForm
        {...props}
        field={
          <PromptField hint="Safe to leave or reload: this page picks it up again.">
            <div className="flex h-40 flex-col justify-center rounded-field border border-input bg-field px-5">
              <GenerationProgress
                generation={generation}
                making="caption"
                providerUnavailable={providerUnavailable}
              />
            </div>
          </PromptField>
        }
      />
    );
  }

  if (generation.status !== "done" || output?.media !== "text") {
    return (
      <GenerationFailure
        generation={generation}
        making="caption"
        notice={props.notice}
        onTryAgain={() => props.onTryAgain(generation.id)}
        pending={props.pending}
      >
        <Button onClick={props.onBack} variant="outline">
          Edit the description
        </Button>
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

/** The screen while its prompt is read: the frame, with a grey box for the prompt. */
function LoadingForm(props: Props) {
  return (
    <RefineForm
      {...props}
      field={
        <PromptField>
          <div
            aria-busy="true"
            aria-label="Loading the prompt"
            className="h-40 skeleton rounded-field"
            role="status"
          />
        </PromptField>
      }
    />
  );
}

/** The prompt's place on the screen when there is no box to edit yet: its label, `children`, `hint`. */
function PromptField({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label asChild>
        <span>Prompt</span>
      </Label>
      {children}
      <p className="min-h-4.5 type-hint text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The prompt box of one basis: `start` until it is edited (edits are kept under `basis`), the
 * enhanced prompt it came from (`enhanced`, to go back to it once changed), and where it came from
 * (`source`), which Generate sends with it.
 */
function CaptionEditor({
  basis,
  enhanced,
  source,
  start,
  ...props
}: Props & {
  basis: string;
  enhanced: string | null;
  source: CaptionSource;
  start: string;
}) {
  const id = useId();
  const { errors, form, onChange, onEnhance, onGenerate, pending } = props;
  const caption = form.captionFor === basis && form.caption !== null ? form.caption : start;
  const changed = enhanced !== null && caption !== enhanced;

  return (
    <RefineForm
      {...props}
      field={
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${id}-caption`}>Prompt</Label>
          {/* Six rows, and a longer prompt scrolls: one that arrives or grows moves nothing under it. */}
          <div className="min-w-0 [&_textarea]:h-40">
            <Textarea
              aria-describedby={`${id}-caption-hint`}
              aria-invalid={errors.includes("caption")}
              id={`${id}-caption`}
              maxLength={4000}
              onChange={(event) =>
                onChange({ ...form, caption: event.target.value, captionFor: basis })
              }
              spellCheck
              value={caption}
            />
          </div>
          <div className="flex min-h-4.5 flex-wrap items-start justify-between gap-x-4">
            <p className="type-hint text-muted-foreground" id={`${id}-caption-hint`}>
              {caption.length} of 4000 characters
            </p>
            {/* Its 44 px target reaches into the gaps around the line, which keeps its height. */}
            {enhanced !== null && changed && (
              <div className="-my-3.5">
                <Button
                  onClick={() => onChange({ ...form, caption: enhanced, captionFor: basis })}
                  size="inline"
                  type="button"
                  variant="link"
                >
                  Back to the enhanced prompt
                </Button>
              </div>
            )}
            {enhanced === null && (
              <div className="-my-3.5">
                <Button
                  disabled={pending !== null}
                  onClick={onEnhance}
                  size="inline"
                  type="button"
                  variant="link"
                >
                  <StableText
                    current={pending === "enhance" ? "Enhancing…" : "Enhance it instead"}
                    labels={["Enhance it instead", "Enhancing…"]}
                  />
                </Button>
              </div>
            )}
          </div>
        </div>
      }
      onSubmit={() => onGenerate(caption, source)}
    />
  );
}

/**
 * The frame of the screen: `field`, the prompt's place, the seed under Advanced, then Generate
 * (`onSubmit`; without it the prompt is not there yet, and Generate waits) and Back. A problem shows
 * beside the actions and a refused action under them, where they move nothing.
 */
function RefineForm({
  errors,
  field,
  form,
  notice,
  onBack,
  onChange,
  onSubmit,
  pending,
}: Props & { field: React.ReactNode; onSubmit?: () => void }) {
  const id = useId();

  return (
    <form
      className="flex min-w-0 flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      {field}

      <Disclosure
        icon={<SlidersHorizontalIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
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
        <p className="type-hint text-muted-foreground" id={`${id}-seed-hint`}>
          The same prompt and seed give the same image. Left blank, a random seed is picked once and
          shown with the result.
        </p>
      </Disclosure>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button disabled={pending !== null || !onSubmit} type="submit" variant="photon">
          <SparklesIcon aria-hidden="true" />
          <StableText
            current={pending === "generate" ? "Starting…" : "Generate character"}
            labels={["Generate character", "Starting…"]}
          />
        </Button>
        <Button onClick={onBack} type="button" variant="ghost">
          <ArrowLeftIcon aria-hidden="true" />
          Back
        </Button>
        {errors.length > 0 && (
          <ul
            aria-label="Problems with the prompt"
            className="min-w-0 flex-1 basis-60 type-caption wrap-anywhere text-destructive-foreground"
            role="alert"
          >
            {errors.map((each) => (
              <li key={each}>{fieldMessages[each]}</li>
            ))}
          </ul>
        )}
      </div>
      {notice}
    </form>
  );
}
