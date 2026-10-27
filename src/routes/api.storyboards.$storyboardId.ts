import { createFileRoute } from "@tanstack/react-router";

import { handleReadStoryboard, handleSaveStoryboard } from "#/features/storyboard/server/http";

export const Route = createFileRoute("/api/storyboards/$storyboardId")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleReadStoryboard(request, params.storyboardId),
      PUT: ({ request, params }) => handleSaveStoryboard(request, params.storyboardId),
    },
  },
});
