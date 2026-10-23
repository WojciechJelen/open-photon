import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { ExamplePage } from "#/features/explore/components/example-page";
import {
  ExploreError,
  ExploreFrame,
  ExploreLoading,
} from "#/features/explore/components/explore-frame";
import { loadExample } from "#/features/explore/explore.functions";

export const Route = createFileRoute("/explore/$slug")({
  loader: async ({ params }) => {
    const example = await loadExample({ data: params.slug });

    if (!example) {
      throw notFound();
    }

    return example;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Example not found · Open Photon" }] };
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
  pendingComponent: () => <ExploreLoading label="Loading the example…" />,
  errorComponent: () => <ExploreError title="This example could not be loaded" />,
  notFoundComponent: () => (
    <ExploreFrame>
      <div className="flex flex-col items-start gap-4">
        <h1 className="font-display text-3xl leading-none font-bold tracking-display">
          This example is no longer in Explore
        </h1>
        <p className="text-soft-foreground">
          It was taken down or its result is gone. The other examples are still there.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/explore">Browse Explore</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/motionTransfer">Make your own</Link>
          </Button>
        </div>
      </div>
    </ExploreFrame>
  ),
  component: Example,
});

function Example() {
  return <ExamplePage example={Route.useLoaderData()} />;
}
