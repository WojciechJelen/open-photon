import { createFileRoute } from "@tanstack/react-router";

import { handleGenerate } from "#/features/genjutsu/server/generate";

export const Route = createFileRoute("/api/generate")({
  server: { handlers: { POST: ({ request }) => handleGenerate(request) } },
});
