import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { GenerationView } from "#/features/genjutsu/components/generation-view";
import { loadResult } from "#/features/genjutsu/generate.functions";
import { Problem } from "#/shared/components/problem";

export const Route = createFileRoute("/g/$generationId")({
  loader: async ({ params }) => {
    const result = await loadResult({ data: params.generationId });

    if (!result) {
      throw notFound();
    }

    return result;
  },
  head: () => ({ meta: [{ title: "Your take · Genjutsu · Open Photon" }] }),
  component: GenerationPage,
  notFoundComponent: () => (
    <Problem title="Generation not found">
      <Link className="underline underline-offset-3" search={{}} to="/genjutsu">
        Start a new generation
      </Link>
    </Problem>
  ),
});

function GenerationPage() {
  const data = Route.useLoaderData();

  // Keyed by id: a retry or re-run opens its child here, with a stream of its own.
  return <GenerationView data={data} key={data.generation.id} />;
}
