import { createFileRoute } from "@tanstack/react-router";

import { handleSaveView } from "#/features/angles/server/http";

export const Route = createFileRoute("/api/angle-sets/$angleSetId/items/$position/character")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleSaveView(request, params.angleSetId, params.position),
    },
  },
});
