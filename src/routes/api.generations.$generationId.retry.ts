import { createFileRoute } from "@tanstack/react-router";

import { startChild } from "#/shared/server/generation/http";
import { retry } from "#/shared/server/generation/service";

export const Route = createFileRoute("/api/generations/$generationId/retry")({
  server: {
    handlers: {
      POST: ({ request, params }) => startChild(request, params.generationId, retry),
    },
  },
});
