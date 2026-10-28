import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";

import { composerSlots } from "#/app/composer-slots";
import { AnglesPage } from "#/features/angles/components/angles-page";
import { loadSelection } from "#/features/motionTransfer/selection.functions";

export const Route = createFileRoute("/angles/")({
  validateSearch: z.object({ character: z.uuid().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ character: search.character }),
  loader: ({ deps }) => loadSelection({ data: { character: deps.character } }),
  head: () => ({ meta: [{ title: "Shots & Angles · Open Photon" }] }),
  component: Angles,
});

function Angles() {
  const navigate = Route.useNavigate();

  const onPick = useCallback(
    (character: string | undefined) => void navigate({ replace: true, search: { character } }),
    [navigate],
  );

  return (
    <AnglesPage
      characterId={Route.useSearch().character}
      characterPicker={composerSlots.characterPicker}
      onPick={onPick}
      selection={Route.useLoaderData()}
    />
  );
}
