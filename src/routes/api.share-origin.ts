import { createFileRoute } from "@tanstack/react-router";

import { handleShareOrigin } from "#/shared/server/public-origin";

export const Route = createFileRoute("/api/share-origin")({
  server: {
    handlers: { GET: ({ request }) => handleShareOrigin(request) },
  },
});
