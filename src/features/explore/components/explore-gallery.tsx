import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, FilmIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { ExamplePreview } from "#/features/explore/components/example-preview";
import { TileSkeleton, tileGrid } from "#/features/explore/components/explore-frame";
import type { ExploreEntry, ExploreSearch } from "#/features/explore/contracts";
import { lookLabels } from "#/features/explore/look-labels";
import { Hud } from "#/shared/components/brand";
import { StateCard } from "#/shared/components/state-card";

/** The "All" segment's value: no slug or look key can be it (`exploreSearchSchema`). */
const ALL = "_all";

/** Each distinct value of one of an entry's tags, in the entries' order. */
function distinct<T extends { key: string }>(values: T[]) {
  return values.filter(
    (value, index) => values.findIndex(({ key }) => key === value.key) === index,
  );
}

/**
 * One filter: "All" and each value, a segmented control that sets this filter (`onFilter`) and
 * keeps the other. Its selected segment takes no room of its own (`reserve-semibold`); a label too
 * long for the screen ends in an ellipsis.
 */
function FilterRow({
  current,
  label,
  name,
  onFilter,
  options,
}: {
  current: string | undefined;
  label: string;
  name: keyof ExploreSearch;
  onFilter: (search: ExploreSearch) => void;
  options: { key: string; label: string; title?: string }[];
}) {
  return (
    <div className="flex max-w-full min-w-0 flex-wrap items-center gap-3">
      <Hud>{name}</Hud>
      <ToggleGroup
        aria-label={label}
        onValueChange={(value) => {
          // Pressing the selected segment again says "" here: it stays selected.
          if (value) {
            onFilter({ [name]: value === ALL ? undefined : value });
          }
        }}
        spacing={1}
        type="single"
        value={current ?? ALL}
        variant="segmented"
      >
        {[{ key: ALL, label: "All", title: undefined }, ...options].map((option) => (
          <ToggleGroupItem key={option.key} title={option.title ?? option.label} value={option.key}>
            <span
              className="reserve-semibold max-w-full min-w-0 grid-cols-1"
              data-label={option.label}
            >
              <span className="max-w-full truncate">{option.label}</span>
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/**
 * One take: the picture opens its page, and Remake, over the picture, recreates it. Remake appears
 * on hover and on keyboard focus, and stays on a touch screen, which has neither; it is drawn 36 px
 * tall, as the board has it, and its target (`before:`) is 44.
 */
function ExampleTile({ entry }: { entry: ExploreEntry }) {
  const name = entry.characterTitle ?? "A character";

  return (
    <li className="min-w-0">
      <figure className="m-0 flex min-w-0 flex-col gap-2.5">
        <div className="group relative">
          <ExamplePreview
            className="aspect-9/16 rounded-field"
            poster={entry.poster}
            video={entry.result}
          />
          <Link
            aria-label={entry.title}
            className="absolute inset-0 rounded-field inset-ring inset-ring-foreground/8 transition-shadow group-hover:inset-ring-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            params={{ slug: entry.slug }}
            to="/explore/$slug"
          />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center rounded-b-field bg-linear-to-t from-background/78 to-transparent px-2.5 pt-8 pb-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100">
            <a
              aria-label={`Remake ${entry.title}: Make this with my character`}
              className="pointer-events-auto relative inline-flex h-9 items-center rounded-full bg-primary px-3.5 type-caption font-semibold text-primary-foreground transition-colors before:absolute before:inset-x-0 before:-inset-y-1 hover:bg-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring motion-reduce:transition-none"
              href={entry.remix.href}
            >
              Remake
            </a>
          </span>
        </div>
        <figcaption className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate type-label" title={name}>
            {name}
          </span>
          <span
            className="max-w-1/2 shrink-0 truncate type-caption text-muted-foreground"
            title={entry.motion.title}
          >
            {entry.motion.title}
          </span>
        </figcaption>
      </figure>
    </li>
  );
}

/**
 * The Explore gallery: the curated takes, filtered by motion and, once they differ, by look
 * (`search`, held in the URL, so a filtered gallery is a link; `onFilter` changes one filter), with
 * a count read out as it changes, and an empty state for no takes at all and for filters nothing
 * matches.
 */
export function ExploreGallery({
  entries,
  onFilter,
  search,
}: {
  entries: ExploreEntry[];
  onFilter: (search: ExploreSearch) => void;
  search: ExploreSearch;
}) {
  const motions = distinct(entries.map(({ motion }) => motion));
  const looks = distinct(entries.map(({ look }) => look));
  const labels = lookLabels(looks);

  const shown = entries.filter(
    (entry) =>
      (search.motion === undefined || entry.motion.key === search.motion) &&
      (search.look === undefined || entry.look.key === search.look),
  );

  // No pre-rendered takes: this installation has not run `scripts/prerender-samples.mjs` yet (the
  // same takes fill the home page's result wall). Said to visitors and to the operator alike.
  if (entries.length === 0) {
    return (
      <StateCard
        icon={FilmIcon}
        text="Sample takes show up here once they are pre-rendered."
        title="No takes yet"
      >
        <Button asChild>
          <Link to="/motionTransfer">
            <span>Start a shot</span>
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
        <p className="w-full type-hint text-pretty text-muted-foreground">
          Running this installation? Pre-render them with{" "}
          <code className="font-mono wrap-anywhere">scripts/prerender-samples.mjs</code> (README,
          Container notes).
        </p>
      </StateCard>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <FilterRow
          current={search.motion}
          label="Filter by motion"
          name="motion"
          options={motions.map(({ key, title }) => ({ key, label: title }))}
          onFilter={onFilter}
        />
        {looks.length > 1 && (
          <FilterRow
            current={search.look}
            label="Filter by look"
            name="look"
            options={looks.map(({ key, text }) => ({
              key,
              label: labels.get(key) ?? text,
              title: text,
            }))}
            onFilter={onFilter}
          />
        )}
      </div>
      <p className="sr-only" role="status">
        {shown.length === entries.length
          ? `${entries.length} ${entries.length === 1 ? "take" : "takes"}`
          : `${shown.length} of ${entries.length} takes`}
      </p>
      {shown.length > 0 ? (
        <ul aria-label="Takes" className={tileGrid}>
          {shown.map((entry) => (
            <ExampleTile entry={entry} key={entry.id} />
          ))}
        </ul>
      ) : (
        <div className={tileGrid}>
          {/* A tile no one sees keeps a row's height, so what is under the gallery stays put. */}
          <TileSkeleton className="invisible col-start-1 row-start-1" />
          <StateCard
            className="col-span-full row-start-1"
            icon={FilmIcon}
            text={looks.length > 1 ? "Try another motion or look." : "Try another motion."}
            title="No takes match"
          >
            <Button
              onClick={() => onFilter({ look: undefined, motion: undefined })}
              variant="outline"
            >
              Clear filters
            </Button>
          </StateCard>
        </div>
      )}
    </div>
  );
}
