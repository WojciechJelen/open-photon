import { createFileRoute } from "@tanstack/react-router";

import { handleReadPhotoshoot } from "#/features/photoshoot/server/http";

export const Route = createFileRoute("/api/photoshoots/$photoshootId")({
  server: {
    handlers: { GET: ({ request, params }) => handleReadPhotoshoot(request, params.photoshootId) },
  },
});
