import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type { loadStudio } from "#/features/motionTransfer/api";
import { AiTag } from "#/features/studio/components/ai-tag";
import { useReducedMotion } from "#/features/studio/reduced-motion";
import { LoopingVideo } from "#/shared/components/looping-video";
import { mediaUrl } from "#/shared/media";

/** A done pre-rendered sample take, as the studio reads it (`listPrerenderedTakes`). */
export type WallTake = Awaited<ReturnType<typeof loadStudio>>["wall"][number];

// How many takes a phone shows: the wall is two columns there, and Explore has the rest.
const PHONE_TAKES = 4;

/**
 * "Made here": the pre-rendered sample takes. A take loops while it is on screen (`LoopingVideo`
 * `lazy`), or stays on its poster for a visitor who asked for less motion, and opens its public
 * share page (the result beside the clip, and the recipe). On a phone the way to Explore moves
 * under the takes, full width.
 */
export function ResultWall({ takes }: { takes: WallTake[] }) {
  const still = useReducedMotion();

  return (
    <section
      aria-labelledby="made-here-heading"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:mt-14 sm:gap-y-4"
    >
      <h2 className="min-w-0 type-heading wrap-anywhere max-sm:w-full" id="made-here-heading">
        Made here
      </h2>
      <span className="flex flex-col max-sm:order-1 max-sm:w-full">
        <Button asChild variant="outline">
          <Link to="/explore">
            <span>Explore all takes</span>
            <ArrowRightIcon />
          </Link>
        </Button>
      </span>
      <ul className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-6">
        {takes.map((take, index) => (
          <li className={cn("min-w-0", index >= PHONE_TAKES && "max-sm:hidden")} key={take.id}>
            <Link
              aria-label={`${take.characterTitle} performs ${take.motionTitle}: open the take, AI-generated`}
              className="relative block aspect-9/16 overflow-hidden rounded-lg border bg-screen transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring sm:rounded-field"
              params={{ slug: take.shareSlug }}
              to="/r/$slug"
            >
              <LoopingVideo
                className="absolute inset-0 size-full rounded-none bg-screen object-cover"
                lazy
                paused={still}
                poster={take.poster ? mediaUrl(take.poster) : undefined}
                src={mediaUrl(take.result)}
              />
              <AiTag className="bottom-2 left-2" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
