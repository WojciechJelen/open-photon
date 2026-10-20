import { createFileRoute } from "@tanstack/react-router";

import { serveMedia } from "#/shared/server/media.server";

export const Route = createFileRoute("/media/$filename")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveMedia(request, params.filename),
      HEAD: ({ request, params }) => serveMedia(request, params.filename),
    },
  },
});
