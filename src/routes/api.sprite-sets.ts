import { createFileRoute } from "@tanstack/react-router";

import { handleCreateSpriteSet, handleListSpriteSets } from "#/features/spriteForge/server/http";

export const Route = createFileRoute("/api/sprite-sets")({
  server: {
    handlers: {
      GET: ({ request }) => handleListSpriteSets(request),
      POST: ({ request }) => handleCreateSpriteSet(request),
    },
  },
});
