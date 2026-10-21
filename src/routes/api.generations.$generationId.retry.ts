import { createFileRoute } from "@tanstack/react-router";

import { retry, startChild } from "#/features/motionTransfer/server/generate";

export const Route = createFileRoute("/api/generations/$generationId/retry")({
  server: {
    handlers: {
      POST: ({ request, params }) => startChild(request, params.generationId, retry),
    },
  },
});
