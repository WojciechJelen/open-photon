import { createFileRoute } from "@tanstack/react-router";

import { handleCharacterCaption } from "#/features/characterBuilder/server/generate";

export const Route = createFileRoute("/api/character-captions")({
  server: { handlers: { POST: ({ request }) => handleCharacterCaption(request) } },
});
