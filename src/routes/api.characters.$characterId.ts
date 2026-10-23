import { createFileRoute } from "@tanstack/react-router";

import { patchCharacter } from "#/features/characters/server/http";

export const Route = createFileRoute("/api/characters/$characterId")({
  server: {
    handlers: { PATCH: ({ request, params }) => patchCharacter(request, params.characterId) },
  },
});
