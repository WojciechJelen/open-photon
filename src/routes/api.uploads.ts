import { createFileRoute } from "@tanstack/react-router";

import { uploadMedia } from "#/server/upload.server";

export const Route = createFileRoute("/api/uploads")({
  server: { handlers: { POST: ({ request }) => uploadMedia(request) } },
});
