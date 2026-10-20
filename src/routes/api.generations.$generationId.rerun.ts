import { createFileRoute } from "@tanstack/react-router";

import { rerun, startChild } from "#/server/generate";

export const Route = createFileRoute("/api/generations/$generationId/rerun")({
  server: {
    handlers: {
      POST: ({ params }) => startChild(params.generationId, rerun),
    },
  },
});
