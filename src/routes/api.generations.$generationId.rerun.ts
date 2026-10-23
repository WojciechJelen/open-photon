import { createFileRoute } from "@tanstack/react-router";

import { startChild } from "#/shared/server/generation/http";
import { rerun } from "#/shared/server/generation/service";

export const Route = createFileRoute("/api/generations/$generationId/rerun")({
  server: {
    handlers: {
      POST: ({ request, params }) => startChild(request, params.generationId, rerun),
    },
  },
});
