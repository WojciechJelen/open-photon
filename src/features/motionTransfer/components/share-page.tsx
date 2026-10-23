import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, DownloadIcon, LockIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { angleName, RecipePanel } from "#/features/motionTransfer/components/recipe-panel";
import type { loadShare } from "#/features/motionTransfer/generate.functions";
import { Hud, PageGlow, REPOSITORY_URL, StatusDot, Viewfinder } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import { GeneratedImage } from "#/shared/components/generated-image";
import { LoopingVideo } from "#/shared/components/looping-video";
import { OpenWeightsBadge, SiteFooter, SiteHeader } from "#/shared/components/site";
import { mediaUrl } from "#/shared/media";
import { duration } from "#/shared/timecode";

type Share = NonNullable<Awaited<ReturnType<typeof loadShare>>>;

export const shareTitle = "Motion Transfer: one motion, another character";

export const shareDescription =
  "The motion of one clip, performed by another character. Made with Open Photon on the Wan Animate 2 workflow.";

/** What the share page of a generation of another workflow is called. */
export const outputsShareTitle = "Made with Open Photon";

export const outputsShareDescription =
  "An AI-generated image made with Open Photon, on open-weights ComfyUI workflows. Run it yourself.";

/** A SHA-256 shortened for reading: its first and last eight characters. */
function shortHash(sha256: string) {
  return `${sha256.slice(0, 8)}…${sha256.slice(-8)}`;
}

/** One input of the recipe: its thumbnail (when it is public), its name and its hash. */
function InputRow({
  name,
  sha256,
  thumb,
}: {
  name: string;
  sha256: string;
  thumb: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="relative grid h-17 w-13 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">
        {thumb}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <b className="text-sm">{name}</b>
        <span className="font-mono text-xs break-all text-muted-foreground">
          sha256 {shortHash(sha256)}
        </span>
      </span>
    </div>
  );
}

/**
 * The public share page of a done generation of a workflow other than Motion Transfer, by the
 * media of its outputs: each image output, labelled AI-generated, with Download (an image
 * generation has no poster and no video).
 */
function OutputsSharePage({ share }: { share: Extract<Share, { view: "outputs" }> }) {
  const images = share.outputs.filter(({ media }) => media === "image");

  return (
    <div className="relative isolate">
      <PageGlow />
      <SiteHeader category={images.length > 0 ? "Image" : undefined}>
        <span className="hidden sm:inline-flex">
          <OpenWeightsBadge />
        </span>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-150 flex-col gap-6 px-4 pt-10 pb-24 sm:px-8">
        <Hud>{outputsShareTitle}</Hud>
        {images.map(({ asset, name }) => (
          <GeneratedImage asset={asset} download key={name} />
        ))}
      </main>
      <SiteFooter tagline="Open Photon · MIT licensed · Built on ComfyUI" />
    </div>
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

/**
 * The public share page of a done Motion Transfer take: the result on a loop with the source
 * clip beside it, "Use this motion with my character" (the wizard with the motion kept, at the
 * character step), Download, Download side-by-side (9:16) when it was stitched (a file, not a
 * player: the result keeps its source inset), and how the shot was made: the inputs (a character
 * photo shows only when it is a sample, as an upload is private), the recipe, and the model files
 * the workflow loads, with a license only where the repository records one.
 */
function MotionTransferSharePage({ share }: { share: Extract<Share, { view: "motionTransfer" }> }) {
  const { character, compare, final, models, motionTitle, poster, recipe, source } = share;
  const portrait = (final.height ?? 0) >= (final.width ?? 0);
  const useMotion = { motion: source.id, step: "character" as const };
  const unpinned = models?.some(({ license }) => license === null) ?? false;

  return (
    <div className="relative isolate">
      <PageGlow />
      <SiteHeader category="Video">
        <span className="hidden sm:inline-flex">
          <OpenWeightsBadge />
        </span>
        <Button asChild size="sm" variant="outline">
          <Link search={{}} to="/motionTransfer">
            Make your own
          </Link>
        </Button>
      </SiteHeader>

      <main className="mx-auto flex w-full max-w-330 flex-col gap-18 px-4 pt-10 pb-24 sm:px-8 lg:pt-16">
        <section className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="relative mx-auto w-full max-w-115 lg:mx-0">
            <figure className="relative overflow-hidden rounded-3xl border bg-screen shadow-monitor">
              <LoopingVideo
                className={
                  portrait
                    ? "aspect-9/16 rounded-none object-cover"
                    : "aspect-video rounded-none object-cover"
                }
                label="Result"
                poster={poster ? mediaUrl(poster) : undefined}
                src={mediaUrl(final)}
              />
              <figcaption className="absolute top-3.5 left-3.5">
                <Badge variant="solid">
                  <StatusDot tone="brand" />
                  Result · loops
                </Badge>
              </figcaption>
              <Viewfinder />
            </figure>
            <figure className="absolute bottom-10 left-3 flex w-28 flex-col gap-2 sm:w-33 lg:-left-7">
              <div className="overflow-hidden rounded-xl border-2 border-background bg-screen shadow-modal">
                <LoopingVideo
                  className="aspect-9/16 rounded-none object-cover"
                  label="Source motion"
                  src={mediaUrl(source)}
                />
              </div>
              <figcaption>
                <Hud tone="foreground">Source motion</Hud>
              </figcaption>
            </figure>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Hud>Made with Open Photon · Motion Transfer</Hud>
            <h1 className="font-display text-5xl leading-none font-bold tracking-display text-balance sm:text-6xl">
              One motion,{" "}
              <span className="bg-linear-100 from-brand via-brand-mid to-brand-2 bg-clip-text text-transparent">
                another character.
              </span>
            </h1>
            <p className="max-w-xl text-lg text-pretty text-soft-foreground">{shareDescription}</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" variant="photon">
                <Link search={useMotion} to="/motionTransfer">
                  Use this motion with my character
                  <ArrowRightIcon />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a download href={`${mediaUrl(final)}?download=1`}>
                  <DownloadIcon />
                  Download
                </a>
              </Button>
              {compare && (
                <Button asChild size="lg" variant="outline">
                  <a download href={`${mediaUrl(compare)}?download=1`}>
                    <DownloadIcon />
                    Download side-by-side (9:16)
                  </a>
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2">
              <Hud>
                {duration(final.duration_ms ?? 0)} · {final.width}×{final.height} ·{" "}
                {final.has_audio ? "with sound" : "silent"}
              </Hud>
              <Hud>Seed {recipe.params.seed}</Hud>
            </div>
          </div>
        </section>

        <section aria-labelledby="made-heading" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2.5">
              <Hud>Open recipe</Hud>
              <h2
                className="font-display text-3xl leading-tight font-bold tracking-display sm:text-4xl"
                id="made-heading"
              >
                How this shot was made
              </h2>
            </div>
            <Button asChild variant="ghost">
              <a href={`${REPOSITORY_URL}#run`}>Run it yourself</a>
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-5 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-6">
              <Hud tone="foreground">Inputs</Hud>
              <InputRow
                name={motionTitle ?? "Motion clip"}
                sha256={recipe.inputs.driving_video_sha256}
                thumb={<ClipStill src={mediaUrl(source)} />}
              />
              <InputRow
                name={character?.title ?? "Character photo (private)"}
                sha256={recipe.inputs.reference_image_sha256}
                thumb={
                  character ? (
                    <img
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      src={mediaUrl(character.image)}
                    />
                  ) : (
                    <LockIcon aria-hidden="true" className="size-4.5" />
                  )
                }
              />
              <dl className="grid grid-cols-2 gap-x-5 gap-y-2 border-t pt-4 text-sm sm:grid-cols-4">
                <dt className="text-muted-foreground">Workflow</dt>
                <dd className="font-mono text-xs leading-5">
                  {recipe.workflow.id} v{recipe.workflow.version}
                </dd>
                <dt className="text-muted-foreground">Angle</dt>
                <dd>{angleName(recipe.angle)}</dd>
                <dt className="text-muted-foreground">Size</dt>
                <dd className="font-mono text-xs leading-5">
                  {recipe.params.width}×{recipe.params.height}
                </dd>
                <dt className="text-muted-foreground">Rendered on</dt>
                <dd>{recipe.target === "cloud" ? "Comfy Cloud" : "Self-hosted ComfyUI"}</dd>
              </dl>
              <RecipePanel recipe={recipe} />
            </div>
            <div className="flex flex-col gap-3.5 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-6">
              <h3>
                <Hud tone="foreground">Model files</Hud>
              </h3>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <Badge asChild variant="brand">
                  <a href={`${REPOSITORY_URL}/actions/workflows/ci.yml`}>
                    Open weights only · CI check
                  </a>
                </Badge>
                <a
                  className="underline underline-offset-4"
                  href={`${REPOSITORY_URL}/blob/main/src/features/motionTransfer/workflows/models.lock`}
                >
                  Model sources and hashes
                </a>
              </div>
              {models ? (
                <ul aria-label="Model files" className="flex flex-col">
                  {models.map(({ file, license }) => (
                    <li
                      className="flex items-center justify-between gap-4 border-t py-3"
                      key={file}
                    >
                      <span className="min-w-0 font-mono text-xs break-all">{file}</span>
                      {license && <Badge variant="brand">{license}</Badge>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-soft-foreground">
                  The workflow has changed since this video was made, so its model files are not
                  listed.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                No partner nodes and no closed APIs: these are the model files the workflow loads.
                {unpinned &&
                  " This render predates model pinning; its model hashes and licenses were not recorded."}
              </p>
            </div>
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-6 rounded-3xl border bg-linear-to-br from-brand/12 via-foreground/2 to-foreground/2 p-8 sm:p-10">
          <div className="flex max-w-2xl flex-col gap-2.5">
            <h2 className="font-display text-3xl leading-tight font-bold tracking-display">
              Your character, this move.
            </h2>
            <p className="text-soft-foreground">
              The motion stays picked. Add a photo or a sample character and render your own take.
            </p>
          </div>
          <Button asChild size="lg">
            <Link search={useMotion} to="/motionTransfer">
              Use this motion
            </Link>
          </Button>
        </section>
      </main>
      <SiteFooter tagline="Open Photon · MIT licensed · Built on ComfyUI" />
    </div>
  );
}
