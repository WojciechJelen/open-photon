import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";

import { composerSlots } from "#/app/composer-slots";
import { loadAngleSets } from "#/features/angles/angles.functions";
import { AnglesPage } from "#/features/angles/components/angles-page";
import { loadSelection } from "#/features/motionTransfer/selection.functions";

export const Route = createFileRoute("/angles/")({
  validateSearch: z.object({ character: z.uuid().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ character: search.character }),
  loader: async ({ deps }) => {
    const selection = await loadSelection({ data: { character: deps.character } });

    // Refused without a session, and the form stands without it.
    return {
      recentSets: selection.signedIn ? (await loadAngleSets()).sets : [],
      selection,
    };
  },
  head: () => ({ meta: [{ title: "Shots & Angles · Open Photon" }] }),
  component: Angles,
});

function Angles() {
  const navigate = Route.useNavigate();
  const { recentSets, selection } = Route.useLoaderData();

  const onPick = useCallback(
    (character: string | undefined) =>
      void navigate({ replace: true, resetScroll: false, search: { character } }),
    [navigate],
  );

  return (
    <AnglesPage
      characterId={Route.useSearch().character}
      characterPicker={composerSlots.characterPicker}
      onPick={onPick}
      recentSets={recentSets}
      selection={selection}
    />
  );
}
