import { createFileRoute } from "@tanstack/react-router";

import { loadBuilderAccess } from "#/features/characterBuilder/access.functions";
import { builderSearchSchema } from "#/features/characterBuilder/builder-search";
import { CharacterBuilder } from "#/features/characterBuilder/components/character-builder";

export const Route = createFileRoute("/characters/new")({
  validateSearch: builderSearchSchema,
  loader: () => loadBuilderAccess(),
  head: () => ({ meta: [{ title: "Describe a character · Open Photon" }] }),
  component: CharacterBuilderPage,
});

function CharacterBuilderPage() {
  return <CharacterBuilder search={Route.useSearch()} signedIn={Route.useLoaderData().signedIn} />;
}
