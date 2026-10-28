import { createFileRoute } from "@tanstack/react-router";

import { handleCreateAngleSet, handleListAngleSets } from "#/features/angles/server/http";

export const Route = createFileRoute("/api/angle-sets")({
  server: {
    handlers: {
      GET: ({ request }) => handleListAngleSets(request),
      POST: ({ request }) => handleCreateAngleSet(request),
    },
  },
});
