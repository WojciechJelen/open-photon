import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowRightIcon,
  DownloadIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { RecipePanel } from "#/features/motionTransfer/components/recipe-panel";
import type { loadShare } from "#/features/motionTransfer/generate.functions";
import { Hud, REPOSITORY_URL, Viewfinder } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import {
  GeneratedOutputs,
  generatedTitle,
  shownOutputs,
} from "#/shared/components/generated-outputs";
import { LoopingVideo } from "#/shared/components/looping-video";
import { Panel } from "#/shared/components/panel";
import { SitePage } from "#/shared/components/site";
import { mediaUrl } from "#/shared/media";

type Share = NonNullable<Awaited<ReturnType<typeof loadShare>>>;

export const shareTitle = "Motion Transfer: one motion, another character";

export const shareDescription =
  "The motion of one clip, performed by another character. Made with Open Photon on the Wan Animate 2 workflow.";

type OutputsShare = Extract<Share, { view: "outputs" }>;

/**
 * What the share page of a generation of another workflow is called (`<title>` and `og:title`)
 * and how it is described, by what it shows (a video before an image): both say it is
 * AI-generated (the FLUX Kommunity licence asks for it for an image).
 */
export function outputsShareText(share: OutputsShare) {
  const media = shownOutputs(share.outputs).media ?? "image";

  return {
    description: `An AI-generated ${media} made with Open Photon, on open-weights ComfyUI workflows. Run it yourself.`,
    title: generatedTitle(media),
  };
}

/**
 * The public share page of a done generation of a workflow other than Motion Transfer, by the
 * media of its outputs: each image and each video output with its poster (`GeneratedOutputs`),
 * labelled AI-generated, with Download, beside what made it.
 */
function OutputsSharePage({ share }: { share: OutputsShare }) {
  const { category, media } = shownOutputs(share.outputs);

  return (
    <SitePage category={category} className="gap-14" top={10}>
      <div className="flex flex-wrap items-start gap-x-18 gap-y-10">
        <div className="flex max-w-120 min-w-0 grow basis-120 flex-col gap-8">
          <GeneratedOutputs outputs={share.outputs} />
        </div>
        <div className="flex min-w-0 grow-999 basis-110 flex-col gap-3.5">
          <Hud>Made with Open Photon</Hud>
          <h1 className="type-title wrap-anywhere">An AI-generated {media ?? "image"}</h1>
          <p className="type-lead text-pretty text-soft-foreground">
            On open-weights ComfyUI workflows. Run it yourself.
          </p>
        </div>
      </div>
    </SitePage>
  );
}

/**
 * `/r/:slug`: a Motion Transfer take (`MotionTransferSharePage`), or a generation of another
 * workflow by the media of its outputs (`OutputsSharePage`).
 */
export function SharePageView({ share }: { share: Share }) {
  return share.view === "motionTransfer" ? (
    <MotionTransferSharePage share={share} />
  ) : (
    <OutputsSharePage share={share} />
  );
}

/** A thumbnail of the recipe's row: `children` fill it. */
function RecipeThumb({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-thumb bg-muted text-muted-foreground shadow-hairline">
      {children}
    </span>
  );
}

/**
 * The public share page of a done Motion Transfer take: the result on a loop, tagged AI-generated,
 * with the source clip on it and a Pause for both, "Use this motion with my character" (the wizard with the motion
 * kept, at the character step), Download, Download side by side when it was stitched (a file, not
 * a player: the result keeps its source inset), the shot in one row (a character photo shows only
 * when it is a sample, as an upload is private) with its recipe to download, the same closing
 * offer, and, folded, the recipe, with the model files the workflow loads where a render from
 * before model pinning recorded none. The recipe is what the page already shows: its download is
 * built here, as `/api/generations/:id/recipe.json` needs a session.
 */
function MotionTransferSharePage({ share }: { share: Extract<Share, { view: "motionTransfer" }> }) {
  const {
    character,
    characterGenerated,
    compare,
    final,
    models,
    motionTitle,
    poster,
    recipe,
    source,
  } = share;

  const [paused, setPaused] = useState(false);
  const portrait = (final.height ?? 0) >= (final.width ?? 0);
  const aspect = portrait ? "aspect-9/16" : "aspect-video";
  const useMotion = { motion: source.id, step: "character" as const };
  const motionName = motionTitle ?? "Your clip";
  const recipeFile = `data:application/json,${encodeURIComponent(JSON.stringify(recipe, null, 2))}`;

  return (
    <SitePage category="Video" className="gap-14" top={10}>
      <section className="flex flex-wrap items-center gap-x-18 gap-y-10">
        <div
          className={cn("min-w-0 grow", portrait ? "max-w-107.5 basis-85" : "max-w-170 basis-150")}
        >
          <figure
            className={cn(
              "relative m-0 overflow-hidden rounded-2xl bg-screen shadow-monitor",
              aspect,
            )}
          >
            <LoopingVideo
              className="absolute inset-0 aspect-auto size-full rounded-none object-cover"
              label="Result"
              paused={paused}
              poster={poster ? mediaUrl(poster) : undefined}
              src={mediaUrl(final)}
            />
            <Viewfinder />
            <figcaption className="absolute top-6 left-6 rounded-tag bg-background/66 px-1.75 py-0.75 type-tag text-foreground">
              AI-generated
            </figcaption>
            <div
              className={cn(
                "absolute bottom-6 left-6 overflow-hidden rounded-lg bg-screen ring-2 ring-background/80",
                aspect,
                portrait ? "w-29.5" : "w-40",
              )}
            >
              <LoopingVideo
                className="absolute inset-0 aspect-auto size-full rounded-none object-cover"
                label="Source motion"
                paused={paused}
                src={mediaUrl(source)}
              />
            </div>
            <span className="absolute right-6 bottom-6">
              <Button
                aria-label={paused ? "Play" : "Pause"}
                onClick={() => setPaused(!paused)}
                size="icon"
                variant="scrim"
              >
                {paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
              </Button>
            </span>
          </figure>
        </div>

        <div className="flex min-w-0 grow-999 basis-110 flex-col gap-6">
          <div className="flex flex-col gap-3.5">
            <Hud>Made with Open Photon</Hud>
            <h1 className="font-display text-4xl leading-none font-bold tracking-display wrap-anywhere lg:text-5xl xl:text-6xl">
              One motion,
              <br />
              <span className="bg-render bg-clip-text text-transparent">another character.</span>
            </h1>
            <p className="max-w-120 type-section font-normal text-pretty wrap-anywhere text-soft-foreground">
              {character?.title ?? "A character"} performing {motionTitle ?? "this motion"}.
              {characterGenerated && " The character is AI-generated."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button asChild>
              <Link search={useMotion} to="/motionTransfer">
                Use this motion with my character
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a download href={`${mediaUrl(final)}?download=1`}>
                <DownloadIcon aria-hidden="true" />
                Download
              </a>
            </Button>
            {compare && (
              <Button asChild variant="ghost">
                <a download href={`${mediaUrl(compare)}?download=1`}>
                  Download side by side
                </a>
              </Button>
            )}
          </div>
          <Panel className="max-w-140 flex-row flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 pr-4.5 pl-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <RecipeThumb>
                <ClipStill label={motionName} src={mediaUrl(source)} />
              </RecipeThumb>
              <PlusIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <RecipeThumb>
                {character ? (
                  <img
                    alt={`${character.title ?? "The character"}, AI-generated image`}
                    className="absolute inset-0 size-full object-cover"
                    src={mediaUrl(character.image)}
                  />
                ) : (
                  <LockIcon aria-hidden="true" className="size-4" />
                )}
              </RecipeThumb>
              <div className="ml-1 flex min-w-0 flex-col">
                <span
                  className="truncate type-label"
                  title={`${motionName}, ${character?.title ?? "private photo"}`}
                >
                  {motionName}, {character?.title ?? "private photo"}
                </span>
                <span className="truncate type-caption text-muted-foreground">
                  {characterGenerated ? "AI-generated character" : "From the photo"}
                </span>
              </div>
            </div>
            <Button asChild size="inline" variant="link">
              <a download="open-photon-recipe.json" href={recipeFile}>
                Download the recipe
              </a>
            </Button>
          </Panel>
        </div>
      </section>

      <Panel className="flex-row flex-wrap items-center justify-between gap-x-8 gap-y-5 px-8 py-7">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-display text-3xl font-bold tracking-display wrap-anywhere">
            Your character, this move.
          </h2>
          <p className="wrap-anywhere text-soft-foreground">
            The motion stays picked. Add a character and render your own take.
          </p>
        </div>
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          <Button asChild size="inline" variant="link">
            <Link search={{}} to="/motionTransfer">
              Make your own
            </Link>
          </Button>
          <Button asChild>
            <Link search={useMotion} to="/motionTransfer">
              Use this motion
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </Panel>

      <RecipePanel recipe={recipe}>
        <div className="flex flex-col gap-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-x-5">
            <Button asChild size="inline" variant="link">
              <a href={`${REPOSITORY_URL}/actions/workflows/ci.yml`}>
                Open weights only · CI check
              </a>
            </Button>
            <Button asChild size="inline" variant="link">
              <a
                href={`${REPOSITORY_URL}/blob/main/src/features/motionTransfer/workflows/models.lock`}
              >
                Model sources and hashes
              </a>
            </Button>
            <Button asChild size="inline" variant="link">
              <a href={`${REPOSITORY_URL}#run`}>Run it yourself</a>
            </Button>
          </div>
          {recipe.models.length === 0 &&
            (models ? (
              <ul aria-label="Model files" className="flex flex-col">
                {models.map(({ file }) => (
                  <li
                    className="border-t py-2.5 font-mono text-xs wrap-anywhere first:border-t-0"
                    key={file}
                  >
                    {file}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="type-caption wrap-anywhere text-soft-foreground">
                The workflow has changed since this video was made, so its model files are not
                listed.
              </p>
            ))}
          <p className="type-caption wrap-anywhere text-muted-foreground">
            No partner nodes and no closed APIs
            {models && ": these are the model files the workflow loads"}.
          </p>
        </div>
      </RecipePanel>
    </SitePage>
  );
}
