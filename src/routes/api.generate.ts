import { createFileRoute } from "@tanstack/react-router";

import { handleGenerate } from "#/features/motionTransfer/server/generate";

export const Route = createFileRoute("/api/generate")({
  server: { handlers: { POST: ({ request }) => handleGenerate(request) } },
});
