import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { composerSlots } from "#/app/composer-slots";
import { Button } from "#/components/ui/button";
import {
  GenerationView,
  generationTitle,
} from "#/features/motionTransfer/components/generation-view";
import { loadResult } from "#/features/motionTransfer/generate.functions";
import { Problem } from "#/shared/components/problem";

export const Route = createFileRoute("/g/$generationId")({
  loader: async ({ params }) => {
    const result = await loadResult({ data: params.generationId });

    if (!result) {
      throw notFound();
    }

    return result;
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? generationTitle(loaderData) : "Generation not found" }],
  }),
  component: GenerationPage,
  notFoundComponent: () => (
    <Problem text="This result doesn't exist." title="Nothing here">
      <Button asChild variant="outline">
        <Link search={{}} to="/motionTransfer">
          Start a new generation
        </Link>
      </Button>
    </Problem>
  ),
});

function GenerationPage() {
  const data = Route.useLoaderData();

  // Keyed by id: a retry or re-run opens its child here, with a stream of its own.
  return (
    <GenerationView
      data={data}
      generationActions={composerSlots.resultGenerationActions}
      key={data.generation.id}
    />
  );
}
