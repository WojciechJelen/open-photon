import { createFileRoute } from "@tanstack/react-router";

import { streamDiagnostics } from "#/server/generation-stream";

export const Route = createFileRoute("/api/debug/streams")({
  server: {
    handlers: {
      GET: () => {
        if (process.env.ENABLE_DEBUG !== "1") {
          return new Response(null, { status: 404 });
        }

        return Response.json({ memory: process.memoryUsage(), streams: streamDiagnostics() });
      },
    },
  },
});
