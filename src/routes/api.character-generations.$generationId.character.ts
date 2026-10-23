import { createFileRoute } from "@tanstack/react-router";

import { handleSaveCharacter } from "#/features/characterBuilder/server/generate";

export const Route = createFileRoute("/api/character-generations/$generationId/character")({
  server: {
    handlers: { POST: ({ request, params }) => handleSaveCharacter(request, params.generationId) },
  },
});
