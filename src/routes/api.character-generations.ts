import { createFileRoute } from "@tanstack/react-router";

import { handleCharacterGeneration } from "#/features/characterBuilder/server/generate";

export const Route = createFileRoute("/api/character-generations")({
  server: { handlers: { POST: ({ request }) => handleCharacterGeneration(request) } },
});
