import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, DownloadIcon } from "lucide-react";
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
import { ClipStill } from "#/shared/components/clip-still";
import { PageHeading } from "#/shared/components/page-heading";
import { Panel } from "#/shared/components/panel";
import { ToolColumns } from "#/shared/components/tool-layout";
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
      className="flex items-center gap-3 rounded-field border py-2 pr-3 pl-2 transition-colors hover:border-edge-strong hover:bg-foreground/4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      search={search}
      to="/motionTransfer"
    >
      <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded-thumb bg-screen">
        {thumb}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-label">{keeps}</span>
        <span className="truncate type-caption text-muted-foreground">{next}</span>
      </span>
      <ArrowRightIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-soft-foreground"
        strokeWidth={1.75}
      />
    </Link>
  );
}

/**
 * Step 5, the result: the source and the result on one clock, side by side or as a swipe (swipe
 * by default below 640 px); Download first, then the vertical side-by-side (`compare`) when it was
 * stitched; the share link; "Make another take", which opens the wizard with the motion or the
 * character kept and this take's direction (`from`) to start from; the generation actions
 * (`generationActions`, by default Re-run) and how a re-run went; the recipe to download, and to
 * read, folded.
 */
export function ResultView({
  character,
  child,
  compare,
  draft,
  final,
  generation,
  generationActions: GenerationActions,
  note,
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
  /** What this take is a retry or a re-run of, under the heading. */
  note?: React.ReactNode;
  onRerun: () => void;
  origin: string;
  poster: string | undefined;
  recipe: Recipe;
  source: Asset;
  /** The status line, for assistive technology. */
  status: React.ReactNode;
}) {
  const wide = useWide();
  const [chosen, setChosen] = useState<CompareView | null>(null);
  const view = chosen ?? (wide ? "side" : "swipe");
  const result = mediaUrl(final);

  const aside = (
    <div className="flex flex-col gap-4">
      <Panel className="gap-4 p-5">
        <div className="flex flex-col gap-2">
          <Button asChild>
            <a download href={`${result}?download=1`}>
              <DownloadIcon aria-hidden="true" />
              Download
            </a>
          </Button>
          {compare && (
            <Button asChild variant="ghost">
              <a download href={`${compare}?download=1`}>
                Download side by side
              </a>
            </Button>
          )}
        </div>
        {generation.share_slug && (
          <div className="border-t pt-4">
            <ShareLink origin={origin} slug={generation.share_slug} />
          </div>
        )}
      </Panel>

      <Panel className="gap-3 p-5" label="Make another take">
        <div className="flex flex-col gap-2">
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
                  alt={character.origin === "generated" ? "AI-generated image" : ""}
                  className="absolute inset-0 size-full object-cover"
                  src={mediaUrl(character.image)}
                />
              }
            />
          )}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-center gap-x-5">
        <GenerationActions child={child} draft={draft} generation={generation} onRerun={onRerun} />
        <Button asChild size="inline" variant="link">
          <a
            download="open-photon-recipe.json"
            href={`/api/generations/${generation.id}/recipe.json`}
          >
            Download the recipe
          </a>
        </Button>
      </div>
      <RecipePanel recipe={recipe} />

      {/* Last in the column: how a re-run went appears under everything, and moves nothing. */}
      {child.state === "reused" && (
        <p aria-label="Re-run" className="type-caption text-soft-foreground" role="status">
          Same recipe, same result: this video is what it makes, so nothing was rendered again.
        </p>
      )}
      {child.state === "refused" && (
        <p className="type-caption text-destructive-foreground" role="alert">
          {child.message}
        </p>
      )}
    </div>
  );

  return (
    <ToolColumns aside={aside} asideLabel="What next">
      <div className="flex flex-col gap-5">
        {status}
        <PageHeading
          actions={
            <ToggleGroup
              aria-label="How to compare"
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
              <ToggleGroupItem value="side">Side by side</ToggleGroupItem>
              <ToggleGroupItem value="swipe">Swipe</ToggleGroupItem>
            </ToggleGroup>
          }
          subtitle={note}
          title="Your shot is ready"
        />
        <ComparePlayer
          auto={chosen === null}
          // `generate` renders a portrait clip as 480×848 and any other as 848×480.
          portrait={(source.height ?? 0) >= (source.width ?? 0)}
          poster={poster}
          result={result}
          source={mediaUrl(source)}
          view={view}
        />
      </div>
    </ToolColumns>
  );
}
