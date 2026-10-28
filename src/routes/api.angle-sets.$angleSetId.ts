import { createFileRoute } from "@tanstack/react-router";

import { handleReadAngleSet } from "#/features/angles/server/http";

export const Route = createFileRoute("/api/angle-sets/$angleSetId")({
  server: {
    handlers: { GET: ({ request, params }) => handleReadAngleSet(request, params.angleSetId) },
  },
});
