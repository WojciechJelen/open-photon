import { Link } from "@tanstack/react-router";
import { cn } from "cn";

import { Badge } from "#/components/ui/badge";
import type { loadStudio } from "#/features/motionTransfer/api";
import { Hud, StatusDot } from "#/shared/components/brand";
import { LoopingVideo } from "#/shared/components/looping-video";
import { mediaUrl } from "#/shared/media";

/** A done pre-rendered sample take, as the studio reads it (`listPrerenderedTakes`). */
export type WallTake = Awaited<ReturnType<typeof loadStudio>>["wall"][number];

const tile = "relative block aspect-9/16 overflow-hidden rounded-xl border bg-screen";

const media = "absolute inset-0 size-full rounded-none object-cover";

const label =
  "absolute inset-x-0 bottom-0 bg-linear-to-t from-background/90 to-transparent px-3 pt-8 pb-2.5 text-sm font-semibold";

/**
 * The result wall: the pre-rendered sample takes (eight tiles at most, source clips included),
 * grouped by motion, each group led by its source clip. A take loops while it is on screen
 * (`LoopingVideo` `lazy`) and opens its public share page (the result beside the clip, and the
 * recipe).
 */
export function ResultWall({ takes }: { takes: WallTake[] }) {
  // The first take of each motion, in the takes' order: where that motion's group starts.
  const leads = takes.filter(
    (take, index) => takes.findIndex(({ source }) => source.id === take.source.id) === index,
  );

  return (
    <section aria-label="Sample takes" className="flex min-w-0 flex-col gap-3">
      <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
        <Hud>Sample takes · {takes.length} renders</Hud>
        <Hud className="inline-flex items-center gap-2" tone="foreground">
          <StatusDot tone="tally" />
          Wan Animate 2
        </Hud>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {leads.flatMap((lead) => [
          <li className={tile} key={lead.source.id}>
            <LoopingVideo className={media} lazy src={mediaUrl(lead.source)} />
            <span className="absolute top-2 left-2">
              <Badge variant="solid">Source</Badge>
            </span>
            <span className={label}>{lead.motionTitle}</span>
          </li>,
          ...takes
            .filter((take) => take.source.id === lead.source.id)
            .map((take) => (
              <li key={take.id}>
                <Link
                  aria-label={`${take.characterTitle} performs ${take.motionTitle}: open the take`}
                  className={cn(
                    tile,
                    "transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
                  )}
                  params={{ slug: take.shareSlug }}
                  to="/r/$slug"
                >
                  <LoopingVideo
                    className={media}
                    lazy
                    poster={take.poster ? mediaUrl(take.poster) : undefined}
                    src={mediaUrl(take.result)}
                  />
                  <span className={label}>{take.characterTitle}</span>
                </Link>
              </li>
            )),
        ])}
      </ul>
      <p className="text-sm text-muted-foreground">
        Sample characters performing the sample motions, rendered at the defaults. Open one for its
        side-by-side and recipe.
      </p>
    </section>
  );
}
