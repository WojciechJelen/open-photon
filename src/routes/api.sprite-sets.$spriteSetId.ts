import { createFileRoute } from "@tanstack/react-router";

import { handleReadSpriteSet } from "#/features/spriteForge/server/http";

export const Route = createFileRoute("/api/sprite-sets/$spriteSetId")({
  server: {
    handlers: { GET: ({ request, params }) => handleReadSpriteSet(request, params.spriteSetId) },
  },
});
