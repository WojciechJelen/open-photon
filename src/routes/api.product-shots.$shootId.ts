import { createFileRoute } from "@tanstack/react-router";

import { handleReadShoot } from "#/features/productStudio/server/http";

export const Route = createFileRoute("/api/product-shots/$shootId")({
  server: { handlers: { GET: ({ request, params }) => handleReadShoot(request, params.shootId) } },
});
