import { createFileRoute } from "@tanstack/react-router";

import { composerSlots } from "#/app/composer-slots";
import { loadSelection } from "#/features/motionTransfer/selection.functions";
import { StoryboardHome } from "#/features/storyboard/components/storyboard-home";

export const Route = createFileRoute("/storyboards/")({
  loader: () => loadSelection({ data: {} }),
  head: () => ({ meta: [{ title: "Storyboards · Open Photon" }] }),
  component: Storyboards,
});

function Storyboards() {
  return (
    <StoryboardHome
      characterPicker={composerSlots.characterPicker}
      characters={Route.useLoaderData().characters}
    />
  );
}
