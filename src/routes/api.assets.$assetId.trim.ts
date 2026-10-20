import { createFileRoute } from "@tanstack/react-router";

import { uploadRefusal } from "#/server/access.server";
import { trimAsset } from "#/server/videos.server";

export const Route = createFileRoute("/api/assets/$assetId/trim")({
  server: {
    handlers: {
      POST: ({ request, params }) => uploadRefusal(request) ?? trimAsset(request, params.assetId),
    },
  },
});
