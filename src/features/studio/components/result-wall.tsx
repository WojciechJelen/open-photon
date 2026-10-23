import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import type { loadStudio } from "#/features/motionTransfer/api";
import { Hud, StatusDot } from "#/shared/components/brand";
import { mediaUrl } from "#/shared/media";

/** A done pre-rendered sample take, as the studio reads it (`listPrerenderedTakes`). */
export type WallTake = Awaited<ReturnType<typeof loadStudio>>["wall"][number];

/**
 * A clip that shows its poster until it is on screen, then loops muted; it pauses off screen.
 * Decoration inside a labelled tile.
 */
function WallVideo({ poster, src }: { poster?: string; src: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  // Once on screen, the source stays set: scrolling back resumes instead of loading again.
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = video.current;

    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      const intersecting = entry?.isIntersecting ?? false;

      setVisible(intersecting);
      setSeen((before) => before || intersecting);
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = video.current;

    if (!element || !seen) {
      return;
    }

    if (!visible) {
      element.pause();
      return;
    }

    // React renders `muted` as a property, not an attribute; set it before asking to play.
    element.muted = true;
    element.play().catch(() => {
      // A browser that refuses autoplay keeps the poster; the tile still opens the take.
    });
  }, [seen, visible]);

  return (
    <video
      aria-hidden="true"
      className="absolute inset-0 size-full object-cover"
      loop
      muted
      playsInline
      poster={poster}
      preload="none"
      ref={video}
      src={seen ? src : undefined}
    />
  );
}

const tile = "relative block aspect-9/16 overflow-hidden rounded-xl border bg-screen";

const label =
  "absolute inset-x-0 bottom-0 bg-linear-to-t from-background/90 to-transparent px-3 pt-8 pb-2.5 text-sm font-semibold";

/**
 * The result wall: every pre-rendered sample take, grouped by motion, each group led by its
 * source clip. A take loops where it is visible and opens its public share page (the result beside
 * the clip, and the recipe).
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
            <WallVideo src={mediaUrl(lead.source)} />
            <span className="absolute top-2 left-2">
              <Badge variant="solid">Source</Badge>
            </span>
            <span className={label}>{lead.motionTitle ?? "Sample motion"}</span>
          </li>,
          ...takes
            .filter((take) => take.source.id === lead.source.id)
            .map((take) => (
              <li key={take.id}>
                <Link
                  aria-label={`${take.characterTitle ?? "A sample character"} performs ${take.motionTitle ?? "a sample motion"}: open the take`}
                  className={cn(
                    tile,
                    "transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
                  )}
                  params={{ slug: take.shareSlug }}
                  to="/r/$slug"
                >
                  <WallVideo
                    poster={take.poster ? mediaUrl(take.poster) : undefined}
                    src={mediaUrl(take.result)}
                  />
                  <span className={label}>{take.characterTitle ?? "Sample character"}</span>
                </Link>
              </li>
            )),
        ])}
      </ul>
      <p className="text-sm text-muted-foreground">
        Every sample character performing every sample motion, rendered at the defaults. Open one
        for its side-by-side and recipe.
      </p>
    </section>
  );
}
