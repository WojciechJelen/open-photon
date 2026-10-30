import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { loadStudio } from "#/features/motionTransfer/selection.functions";
import { ResultWall } from "#/features/studio/components/result-wall";
import { StudioHero } from "#/features/studio/components/studio-hero";
import { StudioTools } from "#/features/studio/components/studio-tools";
import { SitePage } from "#/shared/components/site";

// `/` used to be the whole picker, and links to it name picks: those open the wizard with them.
const searchSchema = z.object({
  motion: z.uuid().optional().catch(undefined),
  character: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    if (search.motion || search.character) {
      throw redirect({
        search: { character: search.character, motion: search.motion },
        to: "/motionTransfer",
      });
    }
  },
  loader: () => loadStudio(),
  component: Studio,
});

function Studio() {
  const { characters, motions, sampleTake, wall } = Route.useLoaderData();

  return (
    <SitePage className="max-sm:gap-11" gap={10} top={14}>
      <StudioHero characters={characters} motions={motions} take={sampleTake} />
      <StudioTools characters={characters} motions={motions} take={sampleTake} />
      {wall.length > 0 && <ResultWall takes={wall} />}
    </SitePage>
  );
}
