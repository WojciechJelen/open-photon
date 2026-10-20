import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { GenerationView } from "#/components/generation-view";
import { loadResult } from "#/lib/generate.functions";

export const Route = createFileRoute("/g/$generationId")({
  loader: async ({ params }) => {
    const result = await loadResult({ data: params.generationId });

    if (!result) {
      throw notFound();
    }

    return result;
  },
  component: GenerationPage,
  notFoundComponent: () => (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Generation not found</h1>
      <Link className="text-sm underline" to="/">
        Start a new generation
      </Link>
    </main>
  ),
});

function GenerationPage() {
  const { generation, origin, source } = Route.useLoaderData();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold">Your generation</h1>
      {/* Keyed by id: a retry opens its child here, with a stream of its own. */}
      <GenerationView initial={generation} key={generation.id} origin={origin} source={source} />
    </main>
  );
}
