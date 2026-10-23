import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, WandSparklesIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { ExamplePreview } from "#/features/explore/components/example-preview";
import type { ExploreEntry, ExploreSearch } from "#/features/explore/contracts";
import { Hud } from "#/shared/components/brand";

/** Each distinct value of one of an entry's tags, in the entries' order. */
function distinct<T extends { key: string }>(values: T[]) {
  return values.filter(
    (value, index) => values.findIndex(({ key }) => key === value.key) === index,
  );
}

/**
 * One row of filter chips: "All" and each value, each a toggle (`aria-pressed`) that sets this
 * filter (`onFilter`) and keeps the other.
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
    <div aria-label={label} className="flex flex-wrap items-center gap-2" role="group">
      <Hud className="w-16 shrink-0">{name}</Hud>
      {[{ key: undefined, label: "All" }, ...options].map((option) => (
        <Button
          aria-pressed={current === option.key}
          key={option.key ?? "all"}
          onClick={() => onFilter({ [name]: option.key })}
          size="xs"
          title={"title" in option ? option.title : undefined}
          variant="chip"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/** One example: its preview and title open its page; the action below recreates it. */
function ExampleCard({ entry }: { entry: ExploreEntry }) {
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      <Link
        className="group flex flex-1 flex-col rounded-xl focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
        params={{ slug: entry.slug }}
        to="/explore/$slug"
      >
        <span className="relative block">
          <ExamplePreview
            className="aspect-9/16 w-full"
            poster={entry.poster}
            video={entry.result}
          />
          {/* The motion is in the title too: the badge is for the eye, so the link reads title first. */}
          <span aria-hidden="true" className="absolute top-2 right-2 left-2 flex flex-wrap gap-1.5">
            <Badge variant="solid">{entry.motion.title}</Badge>
          </span>
        </span>
        <span className="flex flex-col gap-1 px-3 pt-3 pb-2">
          <span className="text-base leading-tight font-semibold group-hover:underline">
            {entry.title}
          </span>
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {entry.look.label} · seed {entry.seed}
          </span>
        </span>
      </Link>
      <div className="grid px-3 pb-3">
        <Button asChild size="xs" variant="outline">
          <a aria-label={`Make this with my character: ${entry.title}`} href={entry.remix.href}>
            <WandSparklesIcon aria-hidden="true" />
            {/* Two lines on a narrow card (a phone's two columns) rather than past its edge. */}
            <span className="text-center leading-tight whitespace-normal">
              Make this with my character
            </span>
          </a>
        </Button>
      </div>
    </li>
  );
}

/**
 * The Explore gallery: the curated examples, filtered by motion and look (`search`, held in the
 * URL, so a filtered gallery is a link; `onFilter` changes one filter), with a count read out as
 * it changes, and an empty state for no examples at all and for filters nothing matches.
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

  const shown = entries.filter(
    (entry) =>
      (search.motion === undefined || entry.motion.key === search.motion) &&
      (search.look === undefined || entry.look.key === search.look),
  );

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed p-8">
        <h2 className="text-xl font-semibold">No examples yet</h2>
        <p className="max-w-prose text-soft-foreground">
          Finished sample takes appear here once they are rendered. Until then, make the first shot
          yourself.
        </p>
        <Button asChild>
          <Link to="/motionTransfer">
            Open Motion Transfer
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <FilterRow
          current={search.motion}
          label="Filter by motion"
          name="motion"
          options={motions.map(({ key, title }) => ({ key, label: title }))}
          onFilter={onFilter}
        />
        <FilterRow
          current={search.look}
          label="Filter by look"
          name="look"
          options={looks.map(({ key, label, text }) => ({ key, label, title: text }))}
          onFilter={onFilter}
        />
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {shown.length === entries.length
          ? `${entries.length} ${entries.length === 1 ? "example" : "examples"}`
          : `${shown.length} of ${entries.length} examples`}
      </p>
      {shown.length > 0 ? (
        <ul
          aria-label="Examples"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
        >
          {shown.map((entry) => (
            <ExampleCard entry={entry} key={entry.id} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed p-8">
          <h2 className="text-xl font-semibold">No example matches these filters</h2>
          <Button
            onClick={() => onFilter({ look: undefined, motion: undefined })}
            variant="outline"
          >
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
