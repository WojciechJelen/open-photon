import { createFileRoute } from "@tanstack/react-router";

import { AnimateAction } from "#/app/result-actions";
import { IMAGE_EDIT_OUTPUT } from "#/features/imageEdit";
import { StoryboardPage } from "#/features/storyboard/components/storyboard-page";

export const Route = createFileRoute("/storyboards/$storyboardId")({
  head: () => ({ meta: [{ title: "Storyboard · Open Photon" }] }),
  component: Storyboard,
});

function Storyboard() {
  const { storyboardId } = Route.useParams();

  // Keyed by id: another storyboard is another page, with reads and edits of its own.
  return (
    <StoryboardPage
      cardActions={(card) =>
        card.generation && (
          <AnimateAction generationId={card.generation.id} output={IMAGE_EDIT_OUTPUT} />
        )
      }
      key={storyboardId}
      storyboardId={storyboardId}
    />
  );
}
