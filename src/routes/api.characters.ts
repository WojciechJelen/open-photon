import { createFileRoute } from "@tanstack/react-router";

import { uploadCharacter } from "#/features/characters/server/http";
import { uploadRefusal } from "#/shared/server/access.server";

export const Route = createFileRoute("/api/characters")({
  server: {
    handlers: { POST: ({ request }) => uploadRefusal(request) ?? uploadCharacter(request) },
  },
});
