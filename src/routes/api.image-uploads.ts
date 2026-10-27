import { createFileRoute } from "@tanstack/react-router";

import { uploadRefusal } from "#/shared/server/access.server";
import { uploadImage } from "#/shared/server/image-upload.server";

export const Route = createFileRoute("/api/image-uploads")({
  server: { handlers: { POST: ({ request }) => uploadRefusal(request) ?? uploadImage(request) } },
});
