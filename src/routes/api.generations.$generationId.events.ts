import { createFileRoute } from "@tanstack/react-router";

import { generationIdParam } from "#/server/generate";
import { streamGeneration } from "#/server/generation-stream";
import { findGeneration } from "#/server/generations";

export const Route = createFileRoute("/api/generations/$generationId/events")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const id = generationIdParam(params.generationId);

        if (id instanceof Response) {
          return id;
        }

        if (!findGeneration(id)) {
          return new Response("Generation not found", { status: 404 });
        }

        return streamGeneration(request, id);
      },
    },
  },
});
