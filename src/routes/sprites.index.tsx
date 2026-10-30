import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { composerSlots } from "#/app/composer-slots";
import { loadSelection } from "#/features/motionTransfer/selection.functions";
import { SpriteForgePage } from "#/features/spriteForge/components/sprite-forge-page";
import { spriteForgeSearchSchema } from "#/features/spriteForge/contracts";

export const Route = createFileRoute("/sprites/")({
  validateSearch: spriteForgeSearchSchema,
  loaderDeps: ({ search }) => ({ character: search.character }),
  loader: ({ deps }) => loadSelection({ data: { character: deps.character } }),
  head: () => ({ meta: [{ title: "Sprite Forge · Open Photon" }] }),
  component: SpriteForge,
});

function SpriteForge() {
  const navigate = Route.useNavigate();

  // The picked character is kept in the URL, replacing the entry so Back leaves the page.
  const onPick = useCallback(
    (character: string | undefined) => void navigate({ replace: true, search: { character } }),
    [navigate],
  );

  return (
    <SpriteForgePage
      characterId={Route.useSearch().character}
      characterPicker={composerSlots.characterPicker}
      onPick={onPick}
      selection={Route.useLoaderData()}
    />
  );
}
