import { createFileRoute } from "@tanstack/react-router";

import { rerun, startChild } from "#/features/genjutsu/server/generate";

export const Route = createFileRoute("/api/generations/$generationId/rerun")({
  server: {
    handlers: {
      POST: ({ request, params }) => startChild(request, params.generationId, rerun),
    },
  },
});
