import { defaultStringifySearch } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  BookmarkCheckIcon,
  BookmarkPlusIcon,
  ClapperboardIcon,
  DownloadIcon,
  LibraryIcon,
  ListTreeIcon,
  Share2Icon,
  ShieldCheckIcon,
  ShuffleIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { type ImageRecipe, readImageRecipe } from "#/features/characterBuilder/builder-client";
import { Disclosure } from "#/features/characterBuilder/components/disclosure";
import {
  GenerationFailure,
  GenerationProgress,
} from "#/features/characterBuilder/components/generation-progress";
import { LoadFailure } from "#/features/characterBuilder/components/load-states";
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
import { Panel } from "#/shared/components/panel";
import { PublishLink } from "#/shared/components/publish-link";
import { ResultFigure } from "#/shared/components/result-figure";
import { StableText } from "#/shared/components/stable-text";
import type { GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import { isFinished } from "#/shared/use-live-generation";

/** What the image screen does, as the page (`CharacterBuilder`) carries it out. */
export type ImageActions = {
  onBack: () => void;
  /** Back to the prompt editor of this image, to change it. */
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
 * Step 3: the image, in one frame from the first moment: the picture's box on the left and the
 * panels on the right. Its progress in that box while it renders, then the picture, the explicit
 * "Save to library", "Animate" once saved (Motion Transfer, with the draft the visitor came with), a
 * download and a share button that opens "Publish & copy link" (it stays private until then), with
 * the prompt and seed it was made from on demand. A failed one says why, and what to do, in a card
 * of its own.
 */
export function ImageStep(props: Props) {
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-6">
      <StepHeading id={headingId} title="Your character" />
      <StoredImage {...props} key={props.imageId} />
    </section>
  );
}

/** The screen's two columns: the picture's box and, beside it or under it, `children`. */
function ImageFrame({ children, figure }: { children: React.ReactNode; figure: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-8">
      <div className="max-w-85 min-w-0 flex-1 basis-75 max-sm:max-w-none">{figure}</div>
      <div className="flex min-w-0 grow-999 basis-85 flex-col gap-4">{children}</div>
    </div>
  );
}

function StoredImage(props: Props) {
  const { loaded, reload } = useStoredGeneration(props.imageId);

  if (loaded.state === "loading") {
    return (
      <ImageFrame
        figure={
          <div
            aria-busy="true"
            aria-label="Loading the image"
            className="aspect-4/7 skeleton rounded-field"
            role="status"
          />
        }
      >
        <div className="h-42 skeleton rounded-2xl" />
        <div className="h-42 skeleton rounded-2xl" />
      </ImageFrame>
    );
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
      <ImageFrame
        figure={
          <div
            aria-hidden="true"
            className="relative aspect-4/7 overflow-hidden rounded-field border bg-screen"
          >
            <span className="absolute inset-0 bg-linear-to-b from-transparent via-brand/16 to-transparent motion-safe:animate-scan motion-reduce:hidden" />
            <span className="absolute inset-0 grid place-items-center font-display text-6xl font-bold tracking-display">
              {generation.status === "waiting" && generation.position !== null ? (
                `#${generation.position}`
              ) : (
                <span>
                  {generation.progress ?? 0}
                  <span className="text-3xl text-soft-foreground">%</span>
                </span>
              )}
            </span>
            <Viewfinder tone="brand" />
          </div>
        }
      >
        <Panel className="gap-3.5 p-5">
          <GenerationProgress
            generation={generation}
            making="image"
            providerUnavailable={providerUnavailable}
          />
        </Panel>
        <Panel className="flex-row items-start gap-3 p-5">
          <ShieldCheckIcon
            aria-hidden="true"
            className="mt-0.5 size-4.5 shrink-0 text-success"
            strokeWidth={1.75}
          />
          <div className="flex min-w-0 flex-col">
            <span className="font-semibold">Safe to leave</span>
            <span className="text-sm text-soft-foreground">
              The render keeps going, and this page picks it up again.
            </span>
          </div>
        </Panel>
      </ImageFrame>
    );
  }

  if (!image) {
    return (
      <GenerationFailure
        generation={generation}
        making="image"
        notice={props.notice}
        onTryAgain={() => props.onTryAgain(generation.id)}
        pending={props.pending}
      >
        <Button onClick={props.onEditCaption} variant="outline">
          Edit the prompt
        </Button>
      </GenerationFailure>
    );
  }

  const url = mediaUrl(image);

  return (
    <ImageFrame
      figure={
        // FLUX Kommunity licence: an output is disclosed as AI-generated wherever it is shown.
        <ResultFigure>
          <img
            alt={
              recipe
                ? `AI-generated character: ${recipe.caption.slice(0, 160)}`
                : "AI-generated character"
            }
            className="absolute inset-0 size-full object-cover"
            height={image.height ?? undefined}
            src={url}
            width={image.width ?? undefined}
          />
        </ResultFigure>
      }
    >
      <SaveCharacter {...props} generationId={generation.id} />
      <Panel className="gap-2.5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {props.saved ? (
            <Button asChild variant="outline">
              <a
                aria-label="Animate this character"
                href={draftHref(withCharacter(props.draft ?? {}, props.saved.id))}
              >
                <ClapperboardIcon aria-hidden="true" />
                Animate
              </a>
            </Button>
          ) : (
            <Button disabled variant="outline">
              <ClapperboardIcon aria-hidden="true" />
              Animate
            </Button>
          )}
          <Button asChild size="icon" variant="outline">
            <a
              aria-label="Download image"
              download={`ai-generated-character-${generation.id.slice(0, 8)}.png`}
              href={url}
            >
              <DownloadIcon aria-hidden="true" strokeWidth={1.75} />
            </a>
          </Button>
          <ShareDialog generation={generation} />
        </div>
        {/* One cell for both, so saving moves nothing under them at any width. */}
        <p className="grid min-w-0 grid-cols-1 type-caption wrap-anywhere text-muted-foreground">
          <span className={cn("col-start-1 row-start-1", props.saved && "invisible")}>
            Save it to animate it. Sharing makes this image public.
          </span>
          <span className={cn("col-start-1 row-start-1", !props.saved && "invisible")}>
            Sharing makes this image public.
          </span>
        </p>
      </Panel>
      <div className="flex flex-wrap gap-1.5">
        <Button
          disabled={props.pending !== null}
          onClick={() => props.onTryAgain(generation.id)}
          size="sm"
          variant="ghost"
        >
          <ShuffleIcon aria-hidden="true" />
          <StableText
            current={props.pending === "again" ? "Starting…" : "Another image"}
            labels={["Another image", "Starting…"]}
          />
        </Button>
        <Button onClick={props.onEditCaption} size="sm" variant="ghost">
          <ArrowLeftIcon aria-hidden="true" />
          Edit the prompt
        </Button>
      </div>
      <Disclosure
        icon={<ListTreeIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
        summary={recipe ? `Seed: ${recipe.seed}` : undefined}
        title="Made with"
      >
        <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 type-caption">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground">Seed</dt>
            <dd className="font-mono break-all" data-testid="image-seed">
              {recipe?.seed ?? "…"}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-mono">{recipe ? `${recipe.width}×${recipe.height}` : "…"}</dd>
          </div>
          <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground">
              {!recipe
                ? "Prompt"
                : recipe.source.enhancement
                  ? recipe.source.enhancement.edited
                    ? "Prompt, enhanced, then edited"
                    : "Prompt, enhanced"
                  : "Prompt, written by hand"}
            </dt>
            <dd
              className="max-h-48 overflow-y-auto font-mono type-hint wrap-anywhere whitespace-pre-wrap text-soft-foreground"
              data-testid="image-caption"
            >
              {recipe?.caption ?? "…"}
            </dd>
          </div>
        </dl>
        <p className="type-hint text-muted-foreground">
          AI-generated with FLUX 3 Image Klein (open weights, FLUX Kommunity licence).
        </p>
      </Disclosure>
      {props.notice}
    </ImageFrame>
  );
}

/**
 * The share button of a done image. Publishing stays the owner's explicit step after checking the
 * image, so it opens `PublishLink`, which says what publishing does and holds the link after.
 */
function ShareDialog({ generation }: { generation: GenerationSnapshot }) {
  const [slug, setSlug] = useState(generation.share_slug);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label="Publish and copy a share link" size="icon" variant="outline">
          <Share2Icon aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} size="sm">
        <DialogHeader>
          <DialogTitle>Share this image</DialogTitle>
        </DialogHeader>
        <PublishLink generationId={generation.id} onPublished={setSlug} slug={slug} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Save to library", an explicit choice, never done on its own: an optional name, then the
 * workspace character. Saving the same image again (a reload, a second click) answers with the
 * same character. Saved, the panel keeps its size: where it is, and the way to it.
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
    const status = `Saved to the library${saved.character?.title ? ` as “${saved.character.title}”` : ""}`;

    return (
      <Panel className="gap-3.5 p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <Label asChild>
            <span>Name</span>
          </Label>
          <p
            aria-live="polite"
            className="flex h-11 min-w-0 items-center gap-2.5 font-semibold"
            data-character={saved.id}
            role="status"
          >
            <BookmarkCheckIcon aria-hidden="true" className="size-4.5 shrink-0 text-success" />
            <span className="truncate" title={status}>
              {status}
            </span>
          </p>
        </div>
        <Button asChild variant="outline">
          <a href={libraryHref}>
            <LibraryIcon aria-hidden="true" />
            Open in library
          </a>
        </Button>
      </Panel>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave(generationId, title.trim() === "" ? undefined : title);
      }}
    >
      <Panel className="gap-3.5 p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${id}-title`}>Name</Label>
          <Input
            id={`${id}-title`}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Name your character"
            value={title}
          />
        </div>
        <Button disabled={pending !== null} type="submit">
          <BookmarkPlusIcon aria-hidden="true" />
          <StableText
            current={pending === "save" ? "Saving…" : "Save to library"}
            labels={["Save to library", "Saving…"]}
          />
        </Button>
      </Panel>
    </form>
  );
}
