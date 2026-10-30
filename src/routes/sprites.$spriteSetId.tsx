import { createFileRoute } from "@tanstack/react-router";

import { SpriteSetPage } from "#/features/spriteForge/components/sprite-set-page";

export const Route = createFileRoute("/sprites/$spriteSetId")({
  head: () => ({ meta: [{ title: "Sprite set · Sprite Forge · Open Photon" }] }),
  component: SpriteSet,
});

function SpriteSet() {
  const { spriteSetId } = Route.useParams();

  // Keyed by id: another set is another page, with its own reads and choices.
  return <SpriteSetPage key={spriteSetId} spriteSetId={spriteSetId} />;
}
