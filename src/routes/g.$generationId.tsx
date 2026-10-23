import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { composerSlots } from "#/app/composer-slots";
import { GenerationView } from "#/features/motionTransfer/components/generation-view";
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
  head: () => ({ meta: [{ title: "Your take · Motion Transfer · Open Photon" }] }),
  component: GenerationPage,
  notFoundComponent: () => (
    <Problem title="Generation not found">
      <Link className="underline underline-offset-3" search={{}} to="/motionTransfer">
        Start a new generation
      </Link>
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
