import { createFileRoute } from "@tanstack/react-router";

import { uploadCharacter } from "#/server/characters.server";

export const Route = createFileRoute("/api/characters")({
  server: { handlers: { POST: ({ request }) => uploadCharacter(request) } },
});
