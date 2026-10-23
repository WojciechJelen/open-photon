import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, Columns2Icon, DownloadIcon, ChevronsLeftRightIcon } from "lucide-react";
import { type ComponentType, useState, useSyncExternalStore } from "react";

import { Button } from "#/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import type { PickableCharacter } from "#/features/characters";
import {
  type CompareView,
  ComparePlayer,
} from "#/features/motionTransfer/components/compare-player";
import { RecipePanel } from "#/features/motionTransfer/components/recipe-panel";
import type { ChildState } from "#/features/motionTransfer/components/render-ended";
import { ShareLink } from "#/features/motionTransfer/components/share-link";
import type { DraftSnapshot, MotionTransferDraft } from "#/features/motionTransfer/draft";
import type { Recipe } from "#/features/motionTransfer/server/recipe";
import type { ResultGenerationActionsProps } from "#/features/motionTransfer/slots";
import { Hud } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import { OpenWeightsBadge } from "#/shared/components/site";
import type { GenerationSnapshot } from "#/shared/contracts";
import type { Asset } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";

const wideQuery = "(min-width: 640px)";

/** Whether the screen is at least 640 px wide; the server renders the wide layout. */
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(wideQuery);

      query.addEventListener("change", onChange);

      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(wideQuery).matches,
    () => true,
  );
}

/** A remix card: a thumbnail of what it keeps, what it keeps, what it asks for next. */
function RemixCard({
  keeps,
  next,
  search,
  thumb,
}: {
  keeps: string;
  next: string;
  search: MotionTransferDraft;
  thumb: React.ReactNode;
}) {
  return (
    <Link
      className="flex items-center gap-3.5 rounded-2xl border bg-foreground/2 py-3 pr-3.5 pl-3 transition-colors hover:border-edge-strong hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      search={search}
      to="/motionTransfer"
    >
      <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
        {thumb}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-sm">{keeps}</b>
        <span className="text-sm text-soft-foreground">{next}</span>
      </span>
      <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0" />
    </Link>
  );
}

/**
 * Step 5, the result: the source and the result on one clock, side by side or as a swipe (swipe
 * by default below 640 px); Download first, then the vertical side-by-side (`compare`) when it was
 * stitched; the share link; "Make another take", which opens the
 * wizard with the motion or the character kept and this take's direction (`from`) to start from;
 * and the recipe, folded, with the generation actions (`generationActions`, by default Re-run)
 * and how a re-run went.
 */
export function ResultView({
  character,
  child,
  compare,
  draft,
  final,
  generation,
  generationActions: GenerationActions,
  onRerun,
  origin,
  poster,
  recipe,
  source,
  status,
}: {
  character: PickableCharacter | null;
  child: ChildState;
  /** The side-by-side's URL; left out when its stitch failed. */
  compare?: string;
  /** This take as a draft, for the generation actions. */
  draft: DraftSnapshot;
  final: Asset;
  generation: GenerationSnapshot;
  generationActions: ComponentType<ResultGenerationActionsProps>;
  onRerun: () => void;
  origin: string;
  poster: string | undefined;
  recipe: Recipe;
  source: Asset;
  /** The status line above the heading. */
  status: React.ReactNode;
}) {
  const wide = useWide();
  const [chosen, setChosen] = useState<CompareView | null>(null);
  const view = chosen ?? (wide ? "side" : "swipe");
  const result = mediaUrl(final);

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2.5">
            {status}
            <h1 className="font-display text-3xl leading-none font-bold tracking-display sm:text-4xl lg:text-5xl">
              Your shot is ready
            </h1>
          </div>
          <ToggleGroup
            aria-label="Compare view"
            onValueChange={(value) => {
              if (value === "side" || value === "swipe") {
                setChosen(value);
              }
            }}
            spacing={1}
            type="single"
            value={view}
            variant="segmented"
          >
            <ToggleGroupItem value="side">
              <Columns2Icon aria-hidden="true" />
              Side by side
            </ToggleGroupItem>
            <ToggleGroupItem value="swipe">
              <ChevronsLeftRightIcon aria-hidden="true" />
              Swipe
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <ComparePlayer
          // `generate` renders a portrait clip as 480×848 and any other as 848×480.
          portrait={(source.height ?? 0) >= (source.width ?? 0)}
          poster={poster}
          result={result}
          source={mediaUrl(source)}
          view={view}
        />
      </div>

      <aside
        aria-label="What next"
        className="flex w-full shrink-0 flex-col gap-4 lg:w-90 lg:pt-20"
      >
        <div className="flex flex-col gap-4 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-5">
          <div className="grid gap-2.5">
            <Button asChild size="lg">
              <a download href={`${result}?download=1`}>
                <DownloadIcon />
                Download MP4
              </a>
            </Button>
            {compare && (
              <Button asChild size="lg" variant="outline">
                <a download href={`${compare}?download=1`}>
                  <DownloadIcon />
                  Download side-by-side (9:16)
                </a>
              </Button>
            )}
          </div>
          {generation.share_slug && <ShareLink origin={origin} slug={generation.share_slug} />}
        </div>

        <section
          aria-labelledby="another-take"
          className="flex flex-col gap-2.5 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-5"
        >
          <h2 className="pb-1">
            <Hud>
              <span id="another-take">Make another take</span>
            </Hud>
          </h2>
          <RemixCard
            keeps="Same motion"
            next="New character"
            search={{ from: generation.id, motion: source.id, step: "character" }}
            thumb={<ClipStill src={mediaUrl(source)} />}
          />
          {/* A character no longer stored (a retired sample, say) cannot be kept. */}
          {character && (
            <RemixCard
              keeps="Same character"
              next="New motion"
              search={{ character: character.id, from: generation.id, step: "motion" }}
              thumb={
                <img
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  src={mediaUrl(character.image)}
                />
              }
            />
          )}
        </section>

        <RecipePanel recipe={recipe}>
          <div className="flex flex-wrap items-center gap-2">
            <GenerationActions
              child={child}
              draft={draft}
              generation={generation}
              onRerun={onRerun}
            />
            <Button asChild size="sm" variant="ghost">
              <a href={`/api/generations/${generation.id}/recipe.json`}>Recipe JSON</a>
            </Button>
          </div>
          {child.state === "reused" && (
            <p aria-label="Re-run" className="text-sm text-soft-foreground" role="status">
              Same recipe, same result: this video is what it makes, so nothing was rendered again.
            </p>
          )}
          {child.state === "refused" && (
            <p className="text-sm text-destructive-foreground" role="alert">
              {child.message}
            </p>
          )}
        </RecipePanel>

        <span className="self-start">
          <OpenWeightsBadge />
        </span>
      </aside>
    </div>
  );
}
