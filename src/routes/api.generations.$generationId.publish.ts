import { createFileRoute } from "@tanstack/react-router";

import { handlePublish } from "#/shared/server/generation/http";

export const Route = createFileRoute("/api/generations/$generationId/publish")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePublish(request, params.generationId),
    },
  },
});
