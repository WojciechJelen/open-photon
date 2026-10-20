import { createFileRoute } from "@tanstack/react-router";

import { retry, startChild } from "#/server/generate";

export const Route = createFileRoute("/api/generations/$generationId/retry")({
  server: {
    handlers: {
      POST: ({ params }) => startChild(params.generationId, retry),
    },
  },
});
