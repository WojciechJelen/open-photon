import { createFileRoute } from "@tanstack/react-router";

import { findGeneration } from "#/shared/server/generation/generations";
import { generationIdParam } from "#/shared/server/generation/http";
import { streamGeneration } from "#/shared/server/generation/stream";

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
