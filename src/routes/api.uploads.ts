import { createFileRoute } from "@tanstack/react-router";

import { uploadRefusal } from "#/server/access.server";
import { uploadVideo } from "#/server/videos.server";

export const Route = createFileRoute("/api/uploads")({
  server: { handlers: { POST: ({ request }) => uploadRefusal(request) ?? uploadVideo(request) } },
});
