import { createFileRoute } from "@tanstack/react-router";

import { handleSaveShot } from "#/features/photoshoot/server/http";

export const Route = createFileRoute("/api/photoshoots/$photoshootId/character")({
  server: {
    handlers: { POST: ({ request, params }) => handleSaveShot(request, params.photoshootId) },
  },
});
