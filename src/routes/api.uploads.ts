import { createFileRoute } from "@tanstack/react-router";

import { uploadVideo } from "#/features/motionTransfer/server/videos.server";
import { uploadRefusal } from "#/shared/server/access.server";

export const Route = createFileRoute("/api/uploads")({
  server: { handlers: { POST: ({ request }) => uploadRefusal(request) ?? uploadVideo(request) } },
});
