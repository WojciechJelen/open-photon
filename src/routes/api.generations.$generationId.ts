import { createFileRoute } from "@tanstack/react-router";

import { generationIdParam } from "#/shared/server/generation/http";
import { readGeneration } from "#/shared/server/generation/service";

export const Route = createFileRoute("/api/generations/$generationId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = generationIdParam(params.generationId);

        if (id instanceof Response) {
          return id;
        }

        const generation = await readGeneration(id);

        return generation
          ? Response.json(generation)
          : Response.json({ error: "Generation not found" }, { status: 404 });
      },
    },
  },
});
