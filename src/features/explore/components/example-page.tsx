import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileCodeIcon,
  LockIcon,
  Share2Icon,
  WandSparklesIcon,
} from "lucide-react";

import { Button } from "#/components/ui/button";
import { ExamplePreview } from "#/features/explore/components/example-preview";
import { ExploreFrame } from "#/features/explore/components/explore-frame";
import type { ExploreDetail } from "#/features/explore/contracts";
import { Hud } from "#/shared/components/brand";
import { LoopingVideo } from "#/shared/components/looping-video";
import { mediaUrl } from "#/shared/media";

/** One row of the readable recipe. */
function Entry({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words sm:col-span-2">{children}</dd>
    </div>
  );
}

/** Where an input that is not public would be: said so, nothing of it shown. */
function PrivateInput({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">
      <span className="flex flex-col items-center gap-2">
        <LockIcon aria-hidden="true" className="size-6" />
        {children}
      </span>
    </div>
  );
}

/**
 * An example's page: the source clip beside the result when that clip is public (a sample
 * motion's; any other is said to be private and not shown), the character the take was made with
 * as far as it is public, "Make this with my character", and the recipe in words, with the public
 * share page and the recipe JSON.
 */
export function ExamplePage({ example }: { example: ExploreDetail }) {
  const { character, recipe, remix, source } = example;

  return (
    <ExploreFrame>
      <div>
        <Button asChild size="inline" variant="link">
          <Link to="/explore">
            <ArrowLeftIcon aria-hidden="true" />
            All examples
          </Link>
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        <Hud>Explore · {example.motion.title}</Hud>
        <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
          {example.title}
        </h1>
      </div>
      <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
        <section
          aria-label="Source and result"
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:col-span-7"
        >
          <figure className="flex min-w-0 flex-col gap-2">
            <div className="relative aspect-9/16 overflow-hidden rounded-xl border bg-screen">
              {source ? (
                <LoopingVideo
                  className="absolute inset-0 size-full rounded-none object-cover"
                  label={`Source motion: ${example.motion.title}`}
                  lazy
                  src={mediaUrl(source)}
                />
              ) : (
                <PrivateInput>The source clip is not public, so it is not shown.</PrivateInput>
              )}
            </div>
            <figcaption>
              <Hud>Source · {example.motion.title}</Hud>
            </figcaption>
          </figure>
          <figure className="flex min-w-0 flex-col gap-2">
            <ExamplePreview
              className="aspect-9/16 rounded-xl border"
              label={`Result: ${example.title}`}
              poster={example.poster}
              video={example.result}
            />
            <figcaption>
              <Hud tone="brand">Result · Wan Animate 2</Hud>
            </figcaption>
          </figure>
        </section>
        <div className="flex flex-col gap-6 lg:col-span-5">
          <section
            aria-labelledby="remake-heading"
            className="flex flex-col gap-3 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-5"
          >
            <h2 className="text-lg font-semibold" id="remake-heading">
              Make this with your character
            </h2>
            <p className="text-sm text-soft-foreground">
              {remix.motionKept
                ? "Opens Motion Transfer with this motion, look and seed. Pick or upload your character; nothing renders until you press Generate."
                : "This take's motion clip is not public, so Motion Transfer asks you for a motion first; the look and seed are kept. Nothing renders until you press Generate."}
            </p>
            <div>
              <Button asChild>
                <a href={remix.href}>
                  <WandSparklesIcon aria-hidden="true" />
                  Make this with my character
                </a>
              </Button>
            </div>
          </section>
          <section aria-labelledby="recipe-heading" className="flex flex-col gap-4">
            <h2
              className="inline-flex items-center gap-2 text-lg font-semibold"
              id="recipe-heading"
            >
              <FileCodeIcon aria-hidden="true" className="size-4 text-brand" />
              Recipe
            </h2>
            <dl aria-labelledby="recipe-heading" className="flex flex-col gap-2.5 text-sm">
              <Entry label="Motion">
                {example.motion.sample ? example.motion.title : "A clip of their own (private)"}
              </Entry>
              <Entry label="Character">
                <span className="flex items-center gap-3">
                  {character?.image ? (
                    <img
                      alt={`${character.title ?? "The character"}, an AI-generated image`}
                      className="h-17 w-13 shrink-0 rounded-lg border object-cover"
                      src={mediaUrl(character.image)}
                    />
                  ) : (
                    <span className="grid h-17 w-13 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
                      <LockIcon aria-hidden="true" className="size-4" />
                    </span>
                  )}
                  <span>
                    {character?.title ?? "A private character"}
                    {!character?.image && (
                      <span className="block text-xs text-muted-foreground">
                        {character
                          ? "The image this take used is no longer this character's."
                          : "Its image is not public."}
                      </span>
                    )}
                  </span>
                </span>
              </Entry>
              <Entry label="Look">{example.look.text}</Entry>
              <Entry label="Seed">
                <span className="font-mono text-xs">{example.seed}</span>
              </Entry>
              <Entry label="Size">
                <span className="font-mono text-xs">
                  {recipe.width}×{recipe.height} · {recipe.fragmentLength} frames per window
                </span>
              </Entry>
              <Entry label="Workflow">
                <span className="font-mono text-xs break-all">
                  {recipe.workflow.id} v{recipe.workflow.version} · {recipe.workflow.sha256}
                </span>
              </Entry>
              <Entry label="Models">
                {recipe.models.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {recipe.models.map((model) => (
                      <li className="font-mono text-xs break-all" key={model.file}>
                        {model.file} · {model.license}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "This render predates model pinning."
                )}
              </Entry>
              <Entry label="Rendered on">
                {recipe.target === "cloud" ? "Comfy Cloud" : "Self-hosted ComfyUI"}
              </Entry>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={example.pageUrl}>
                  <Share2Icon aria-hidden="true" />
                  Share page
                </a>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a href={example.recipeUrl}>
                  <FileCodeIcon aria-hidden="true" />
                  Recipe JSON
                </a>
              </Button>
              {example.compare && (
                <Button asChild size="sm" variant="ghost">
                  <a href={`${mediaUrl(example.compare)}?download=1`}>
                    <DownloadIcon aria-hidden="true" />
                    Download side-by-side
                  </a>
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>
    </ExploreFrame>
  );
}
