import { createFileRoute } from "@tanstack/react-router";

import { handleCreateSpriteSheet } from "#/features/spriteForge/server/http";

export const Route = createFileRoute("/api/sprite-sets/$spriteSetId/sheets")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleCreateSpriteSheet(request, params.spriteSetId),
    },
  },
});
