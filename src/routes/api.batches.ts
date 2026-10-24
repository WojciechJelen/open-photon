import { createFileRoute } from "@tanstack/react-router";

import { handleCreateBatch, handleListBatches } from "#/features/batches/server/http";

export const Route = createFileRoute("/api/batches")({
  server: {
    handlers: {
      GET: ({ request }) => handleListBatches(request),
      POST: ({ request }) => handleCreateBatch(request),
    },
  },
});
