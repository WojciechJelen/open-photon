import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { loadStudio } from "#/features/motionTransfer/selection.functions";
import { StudioHero } from "#/features/studio/components/studio-hero";
import { BuiltOpen, StudioTools } from "#/features/studio/components/studio-tools";
import { PageGlow } from "#/shared/components/brand";
import { GithubButton, OpenWeightsBadge, SiteFooter, SiteHeader } from "#/shared/components/site";

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
  const { characters, motions, sampleTake } = Route.useLoaderData();

  return (
    <div className="relative isolate">
      <PageGlow />
      <SiteHeader nav>
        <span className="hidden sm:inline-flex">
          <OpenWeightsBadge />
        </span>
        <GithubButton label="Star on GitHub" />
      </SiteHeader>
      <main>
        <StudioHero characters={characters} motions={motions} take={sampleTake} />
        <StudioTools characters={characters} motions={motions} take={sampleTake} />
        <BuiltOpen />
      </main>
      <SiteFooter tagline="Open Photon · MIT licensed · Made for #OpenSourceHiggsfield" />
    </div>
  );
}
