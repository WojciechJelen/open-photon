import { createFileRoute } from "@tanstack/react-router";

import { builderSearchSchema } from "#/features/characterBuilder/builder-search";
import { CharacterBuilder } from "#/features/characterBuilder/components/character-builder";
import { loadSelection } from "#/features/motionTransfer/selection.functions";

export const Route = createFileRoute("/characters/new")({
  validateSearch: builderSearchSchema,
  loader: () => loadSelection({ data: {} }),
  head: () => ({ meta: [{ title: "Describe a character · Open Photon" }] }),
  component: CharacterBuilderPage,
});

function CharacterBuilderPage() {
  return <CharacterBuilder samples={Route.useLoaderData().samples} search={Route.useSearch()} />;
}
