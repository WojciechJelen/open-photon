import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { streamGeneration } from "#/server/generation-stream";
import { findGeneration } from "#/server/generations";

export const Route = createFileRoute("/api/generations/$generationId/events")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const id = z.uuid().safeParse(params.generationId);

        if (!id.success) {
          return new Response("Invalid generation ID", { status: 400 });
        }

        if (!findGeneration(id.data)) {
          return new Response("Generation not found", { status: 404 });
        }

        return streamGeneration(request, id.data);
      },
    },
  },
});
