import { createFileRoute } from "@tanstack/react-router";

import {
  ExploreError,
  ExploreFrame,
  ExploreHeading,
  ExploreLoading,
} from "#/features/explore/components/explore-frame";
import { ExploreGallery } from "#/features/explore/components/explore-gallery";
import { type ExploreSearch, exploreSearchSchema } from "#/features/explore/contracts";
import { loadExplore } from "#/features/explore/explore.functions";

const description =
  "Finished Motion Transfer takes made with open weights: see the source beside the result, read the recipe, and remake any of them with your own character.";

// Filters are applied on the page, so changing one reuses the loaded examples.
export const Route = createFileRoute("/explore/")({
  // Only the page is a chunk of its own: the error page (Try again) ships with the route, as
  // `/explore/$slug`'s does, since it is what shows when the network is gone.
  codeSplitGroupings: [["component"]],
  validateSearch: exploreSearchSchema,
  loader: () => loadExplore(),
  // A filter changes only the search: the examples loaded a moment ago are still the list.
  staleTime: 60_000,
  head: () => ({
    meta: [
      { title: "Explore · Open Photon" },
      { name: "description", content: description },
      { property: "og:title", content: "Explore · Open Photon" },
      { property: "og:description", content: description },
    ],
  }),
  pendingMs: 200,
  pendingComponent: () => <ExploreLoading label="Loading examples…" />,
  errorComponent: () => <ExploreError title="Explore could not be loaded" />,
  component: Explore,
});

function Explore() {
  const navigate = Route.useNavigate();

  return (
    <ExploreFrame>
      <ExploreHeading />
      <ExploreGallery
        entries={Route.useLoaderData()}
        onFilter={(next: ExploreSearch) =>
          void navigate({ resetScroll: false, search: (current) => ({ ...current, ...next }) })
        }
        search={Route.useSearch()}
      />
    </ExploreFrame>
  );
}
