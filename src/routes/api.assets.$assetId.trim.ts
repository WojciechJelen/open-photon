import { createFileRoute } from "@tanstack/react-router";

import { trimAsset } from "#/server/videos.server";

export const Route = createFileRoute("/api/assets/$assetId/trim")({
  server: {
    handlers: { POST: ({ request, params }) => trimAsset(request, params.assetId) },
  },
});
