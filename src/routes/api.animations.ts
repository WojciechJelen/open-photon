import { createFileRoute } from "@tanstack/react-router";

import { handleAnimation } from "#/features/animateImage/server/generate";

export const Route = createFileRoute("/api/animations")({
  server: { handlers: { POST: ({ request }) => handleAnimation(request) } },
});
