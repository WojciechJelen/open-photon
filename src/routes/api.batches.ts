import { createFileRoute } from "@tanstack/react-router";

import { handleCreateBatch, handleListBatches } from "#/features/batches/server/http";
import { motionTransferDefinition } from "#/features/motionTransfer/workflows/definition";

export const Route = createFileRoute("/api/batches")({
  server: {
    handlers: {
      GET: ({ request }) => handleListBatches(request),
      POST: ({ request }) => handleCreateBatch(request, motionTransferDefinition),
    },
  },
});
