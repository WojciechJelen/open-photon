import { createFileRoute } from "@tanstack/react-router";

import { uploadRefusal } from "#/server/access.server";
import { uploadCharacter } from "#/server/characters.server";

export const Route = createFileRoute("/api/characters")({
  server: {
    handlers: { POST: ({ request }) => uploadRefusal(request) ?? uploadCharacter(request) },
  },
});
