import { defaultStringifySearch } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BookmarkCheckIcon,
  BookmarkPlusIcon,
  ClapperboardIcon,
  DownloadIcon,
  LibraryIcon,
  ShuffleIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { type ImageRecipe, readImageRecipe } from "#/features/characterBuilder/builder-client";
import {
  GenerationFailure,
  GenerationProgress,
} from "#/features/characterBuilder/components/generation-progress";
import { LoadFailure, StepSkeleton } from "#/features/characterBuilder/components/load-states";
import { StepHeading } from "#/features/characterBuilder/components/step-heading";
import {
  useFollowedGeneration,
  useStoredGeneration,
} from "#/features/characterBuilder/use-followed-generation";
import type { CharacterSummary } from "#/features/characters";
import {
  carryDraft,
  draftHref,
  type DraftSnapshot,
  withCharacter,
} from "#/features/motionTransfer/api";
import { Viewfinder } from "#/shared/components/brand";
import { PublishLink } from "#/shared/components/publish-link";
import type { GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import { isFinished } from "#/shared/use-live-generation";

/** What the image screen does, as the page (`CharacterBuilder`) carries it out. */
export type ImageActions = {
  onBack: () => void;
  /** Back to the caption editor of this image, to change it. */
  onEditCaption: () => void;
  /** Save the image as a workspace character, with an optional title. */
  onSave: (generationId: string, title: string | undefined) => void;
  /**
   * A new image of the caption and source `imageId` was made from, with a new seed: "Another
   * image", or a failed one tried again.
   */
  onTryAgain: (imageId: string) => void;
  onUnlock: (resume: () => void) => void;
};

type Props = ImageActions & {
  draft: DraftSnapshot | undefined;
  imageId: string;
  /** The refusal of the last action, with its recovery; shown whatever state the image is in. */
  notice: React.ReactNode;
  pending: string | null;
  /** The character the image was saved as: its summary once saved here, else its id from the URL. */
  saved: { character: CharacterSummary | null; id: string } | null;
};

const headingId = "builder-image-title";

/**
 * Step 3: the image. Its progress while it renders; why it failed and what to do; then the
 * picture with the caption and seed it was made from, a download, the explicit "Save to library"
 * and "Publish & copy link" (it stays private until then). Once saved: open it in the library, or
 * animate it (Motion Transfer, with the draft the visitor came with).
 */
export function ImageStep(props: Props) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-7">
      <StepHeading id={headingId} label="Step 3 of 3" title="Your character">
        Rendered by FLUX 3 Image Klein from your caption. Keep it by saving it to the workspace
        library, then animate it.
      </StepHeading>
      <StoredImage {...props} key={props.imageId} />
    </section>
  );
}

function StoredImage(props: Props) {
  const { loaded, reload } = useStoredGeneration(props.imageId);

  if (loaded.state === "loading") {
    return <StepSkeleton label="Loading the image" />;
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

  return <LiveImage {...props} initial={loaded.data} />;
}

/** The image generation's recipe, once it is done. */
function useImageRecipe(id: string, done: boolean) {
  const [recipe, setRecipe] = useState<ImageRecipe | null>(null);

  useEffect(() => {
    if (!done) {
      return;
    }

    let stopped = false;

    void readImageRecipe(id).then((answer) => {
      if (!stopped && "data" in answer) {
        setRecipe(answer.data);
      }
    });

    return () => {
      stopped = true;
    };
  }, [id, done]);

  return recipe;
}

function LiveImage(props: Props & { initial: GenerationSnapshot }) {
  const { generation, output, providerUnavailable } = useFollowedGeneration(props.initial, "image");

  const image = output && output.media === "image" ? output.asset : null;
  const recipe = useImageRecipe(generation.id, image !== null);

  if (!isFinished(generation.status)) {
    return (
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div
          aria-hidden="true"
          className="relative mx-auto aspect-4/7 w-full max-w-60 shrink-0 overflow-hidden rounded-3xl border bg-screen shadow-monitor sm:max-w-72 lg:mx-0"
        >
          <span className="absolute inset-0 bg-linear-to-b from-transparent via-brand/16 to-transparent motion-safe:animate-scan motion-reduce:hidden" />
          <span className="absolute inset-0 grid place-items-center font-display text-6xl font-bold tracking-display">
            {generation.progress ?? 0}
            <span className="text-3xl text-soft-foreground">%</span>
          </span>
          <Viewfinder tone="brand" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <GenerationProgress
            generation={generation}
            making="image"
            providerUnavailable={providerUnavailable}
          />
          <p className="text-sm text-soft-foreground">
            Safe to leave or reload: the render keeps going, and this page picks it up again.
          </p>
        </div>
      </div>
    );
  }

  if (!image) {
    return (
      <GenerationFailure
        generation={generation}
        making="image"
        onTryAgain={() => props.onTryAgain(generation.id)}
        pending={props.pending}
      >
        <Button onClick={props.onEditCaption} size="lg" variant="outline">
          Edit the caption
        </Button>
        {props.notice}
      </GenerationFailure>
    );
  }

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <figure className="mx-auto flex w-full max-w-sm shrink-0 flex-col gap-3 lg:mx-0 lg:max-w-md">
        {/* FLUX Kommunity licence: an output is disclosed as AI-generated wherever it is shown. */}
        <div className="relative">
          <img
            alt={
              recipe
                ? `AI-generated character: ${recipe.caption.slice(0, 160)}`
                : "AI-generated character"
            }
            className="w-full rounded-3xl border bg-screen"
            height={image.height ?? undefined}
            src={mediaUrl(image)}
            width={image.width ?? undefined}
          />
          <span className="absolute top-3.5 left-3.5">
            <Badge variant="solid">AI-generated image</Badge>
          </span>
        </div>
        <figcaption className="text-sm text-soft-foreground">
          AI-generated with FLUX 3 Image Klein (open weights, FLUX Kommunity licence).
        </figcaption>
        <Button asChild variant="outline">
          <a
            download={`ai-generated-character-${generation.id.slice(0, 8)}.png`}
            href={mediaUrl(image)}
          >
            <DownloadIcon aria-hidden="true" />
            Download image
          </a>
        </Button>
      </figure>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <SaveCharacter {...props} generationId={generation.id} />
        <div className="rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-5">
          <PublishLink generationId={generation.id} slug={generation.share_slug} />
        </div>
        {props.notice}
        <dl
          aria-label="Made with"
          className="flex flex-col gap-4 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-5 text-sm"
        >
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Seed</dt>
              <dd className="font-mono" data-testid="image-seed">
                {recipe?.seed ?? "…"}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Size</dt>
              <dd className="font-mono">{recipe ? `${recipe.width}×${recipe.height}` : "…"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Caption</dt>
              <dd>
                {recipe ? (
                  <Badge>
                    {recipe.source.enhancement
                      ? recipe.source.enhancement.edited
                        ? "Enhanced, then edited"
                        : "Enhanced"
                      : "Written by hand"}
                  </Badge>
                ) : (
                  "…"
                )}
              </dd>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Caption used</dt>
            <dd
              className="max-h-48 overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-soft-foreground"
              data-testid="image-caption"
            >
              {recipe?.caption ?? "…"}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2.5">
          <Button
            disabled={props.pending !== null}
            onClick={() => props.onTryAgain(generation.id)}
            variant="ghost"
          >
            <ShuffleIcon aria-hidden="true" />
            {props.pending === "again" ? "Starting…" : "Another image, same caption"}
          </Button>
          <Button onClick={props.onEditCaption} variant="ghost">
            <ArrowLeftIcon aria-hidden="true" />
            Edit the caption
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Save to library", an explicit choice, never done on its own: an optional title, then the
 * workspace character. Saving the same image again (a reload, a second click) answers with the
 * same character. Saved: where it is, and the way on to animating it.
 */
function SaveCharacter({
  draft,
  generationId,
  onSave,
  pending,
  saved,
}: Props & { generationId: string }) {
  const id = useId();
  const [title, setTitle] = useState("");

  if (saved) {
    const libraryHref = `/characters${defaultStringifySearch({ selected: saved.id, ...carryDraft(draft) })}`;

    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-success/40 bg-success/6 p-5">
        <p
          aria-live="polite"
          className="flex items-center gap-2.5 font-semibold"
          data-character={saved.id}
          role="status"
        >
          <BookmarkCheckIcon aria-hidden="true" className="size-5 text-success" />
          Saved to the library
          {saved.character?.title ? ` as “${saved.character.title}”` : ""}
        </p>
        <p className="text-sm text-soft-foreground">
          Everyone with an access code to this workspace can see and use it.
        </p>
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <Button asChild size="lg" variant="photon">
            <a href={draftHref(withCharacter(draft ?? {}, saved.id))}>
              <ClapperboardIcon aria-hidden="true" />
              Animate this character
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={libraryHref}>
              <LibraryIcon aria-hidden="true" />
              Open in library
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(generationId, title.trim() === "" ? undefined : title);
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>Name (optional)</Label>
        <Input
          aria-describedby={`${id}-title-hint`}
          id={`${id}-title`}
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Lighthouse keeper"
          value={title}
        />
        <p className="text-sm text-muted-foreground" id={`${id}-title-hint`}>
          Saved to the workspace library, shared by everyone with an access code. Nothing is saved
          until you choose to.
        </p>
      </div>
      <div>
        <Button disabled={pending !== null} size="lg" type="submit">
          <BookmarkPlusIcon aria-hidden="true" />
          {pending === "save" ? "Saving…" : "Save to library"}
        </Button>
      </div>
    </form>
  );
}
