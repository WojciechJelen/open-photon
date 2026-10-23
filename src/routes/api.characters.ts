import { createFileRoute } from "@tanstack/react-router";

import { listLibrary, uploadCharacter } from "#/features/characters/server/http";
import { uploadRefusal } from "#/shared/server/access.server";

export const Route = createFileRoute("/api/characters")({
  server: {
    handlers: {
      GET: ({ request }) => listLibrary(request),
      POST: ({ request }) => uploadRefusal(request) ?? uploadCharacter(request),
    },
  },
});
