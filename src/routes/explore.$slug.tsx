import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { ExamplePage } from "#/features/explore/components/example-page";
import { ExploreError, TakeLoading } from "#/features/explore/components/explore-frame";
import { loadExample } from "#/features/explore/explore.functions";
import { Problem } from "#/shared/components/problem";

export const Route = createFileRoute("/explore/$slug")({
  // Only the page is a chunk of its own: the error (Try again) and not-found pages ship with the
  // route, since they are what shows when the network is gone, when no chunk can be fetched (a
  // lazy one that fails to load reloads the whole document, which offline is the browser's error).
  codeSplitGroupings: [["component"]],
  loader: async ({ params }) => {
    const example = await loadExample({ data: params.slug });

    if (!example) {
      throw notFound();
    }

    return example;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Take not found · Open Photon" }] };
    }

    const title = `${loaderData.title} · Explore · Open Photon`;
    const description = `Recreate “${loaderData.title}” with your own character: the motion, look and seed come with it.`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  pendingMs: 200,
  pendingComponent: () => <TakeLoading label="Loading the take…" />,
  errorComponent: () => <ExploreError title="This take didn't load" />,
  notFoundComponent: () => (
    <Problem
      text="It was taken down or its result is gone. The other takes are still there."
      title="This take is no longer in Explore"
    >
      <Button asChild>
        <Link to="/explore">Browse Explore</Link>
      </Button>
      <Button asChild variant="outline">
        <Link to="/motionTransfer">Make your own</Link>
      </Button>
    </Problem>
  ),
  component: Example,
});

function Example() {
  return <ExamplePage example={Route.useLoaderData()} />;
}
