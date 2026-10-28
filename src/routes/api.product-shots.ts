import { createFileRoute } from "@tanstack/react-router";

import { handleCreateShoot, handleListShoots } from "#/features/productStudio/server/http";

export const Route = createFileRoute("/api/product-shots")({
  server: {
    handlers: {
      GET: ({ request }) => handleListShoots(request),
      POST: ({ request }) => handleCreateShoot(request),
    },
  },
});
