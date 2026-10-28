import { createFileRoute } from "@tanstack/react-router";

import { handleCreateStoryboard, handleListStoryboards } from "#/features/storyboard/server/http";

export const Route = createFileRoute("/api/storyboards")({
  server: {
    handlers: {
      GET: ({ request }) => handleListStoryboards(request),
      POST: ({ request }) => handleCreateStoryboard(request),
    },
  },
});
