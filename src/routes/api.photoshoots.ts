import { createFileRoute } from "@tanstack/react-router";

import { handleCreatePhotoshoot, handleListPhotoshoots } from "#/features/photoshoot/server/http";

export const Route = createFileRoute("/api/photoshoots")({
  server: {
    handlers: {
      GET: ({ request }) => handleListPhotoshoots(request),
      POST: ({ request }) => handleCreatePhotoshoot(request),
    },
  },
});
