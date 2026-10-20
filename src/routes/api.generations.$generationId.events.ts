import { createFileRoute } from "@tanstack/react-router";

import { generationIdParam } from "#/features/genjutsu/server/generate";
import { streamGeneration } from "#/features/genjutsu/server/generation-stream";
import { findGeneration } from "#/features/genjutsu/server/generations";

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
