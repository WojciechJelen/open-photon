import { createFileRoute } from "@tanstack/react-router";

import { handleGenerateCards } from "#/features/storyboard/server/http";

export const Route = createFileRoute("/api/storyboards/$storyboardId/generations")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleGenerateCards(request, params.storyboardId),
    },
  },
});
