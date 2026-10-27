import { createFileRoute } from "@tanstack/react-router";

import { PhotoshootPage } from "#/features/photoshoot/components/photoshoot-page";

export const Route = createFileRoute("/photoshoot/$photoshootId")({
  head: () => ({ meta: [{ title: "Photoshoot · Open Photon" }] }),
  component: Photoshoot,
});

function Photoshoot() {
  const { photoshootId } = Route.useParams();

  // Keyed by id: another photoshoot is another page, with reads of its own.
  return <PhotoshootPage key={photoshootId} photoshootId={photoshootId} />;
}
