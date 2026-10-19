import { createFileRoute } from "@tanstack/react-router";

import { uploadVideo } from "#/server/videos.server";

export const Route = createFileRoute("/api/uploads")({
  server: { handlers: { POST: ({ request }) => uploadVideo(request) } },
});
