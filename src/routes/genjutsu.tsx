import { createFileRoute } from "@tanstack/react-router";

import { GenjutsuWizard } from "#/features/genjutsu/components/genjutsu-wizard";
import { loadSelection } from "#/features/genjutsu/selection.functions";
import { wizardSearchSchema } from "#/features/genjutsu/wizard";

// The step is not a loader dependency: moving between steps reuses the picks' data.
export const Route = createFileRoute("/genjutsu")({
  validateSearch: wizardSearchSchema,
  loaderDeps: ({ search }) => ({
    character: search.character,
    from: search.from,
    motion: search.motion,
  }),
  loader: ({ deps }) => loadSelection({ data: deps }),
  head: () => ({ meta: [{ title: "Genjutsu · Open Photon" }] }),
  component: Genjutsu,
});

function Genjutsu() {
  const search = Route.useSearch();

  // Keyed by `from`: another take's direction starts the Direct step afresh.
  return (
    <GenjutsuWizard key={search.from ?? ""} search={search} selection={Route.useLoaderData()} />
  );
}
