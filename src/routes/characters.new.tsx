import { createFileRoute } from "@tanstack/react-router";

import { builderSearchSchema } from "#/features/characterBuilder/builder-search";
import { CharacterBuilder } from "#/features/characterBuilder/components/character-builder";

export const Route = createFileRoute("/characters/new")({
  validateSearch: builderSearchSchema,
  head: () => ({ meta: [{ title: "Describe a character · Open Photon" }] }),
  component: CharacterBuilderPage,
});

function CharacterBuilderPage() {
  return <CharacterBuilder search={Route.useSearch()} />;
}
