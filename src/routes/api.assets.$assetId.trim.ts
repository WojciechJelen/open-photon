import { createFileRoute } from "@tanstack/react-router";

import { trimAsset } from "#/features/motionTransfer/server/videos.server";
import { uploadRefusal } from "#/shared/server/access.server";

export const Route = createFileRoute("/api/assets/$assetId/trim")({
  server: {
    handlers: {
      POST: ({ request, params }) => uploadRefusal(request) ?? trimAsset(request, params.assetId),
    },
  },
});
