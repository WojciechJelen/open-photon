import { createFileRoute } from "@tanstack/react-router";

import { handleReadBatch } from "#/features/batches/server/http";

export const Route = createFileRoute("/api/batches/$batchId")({
  server: { handlers: { GET: ({ request, params }) => handleReadBatch(request, params.batchId) } },
});
