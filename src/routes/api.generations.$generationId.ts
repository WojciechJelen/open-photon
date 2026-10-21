import { createFileRoute } from "@tanstack/react-router";

import { readGeneration, generationIdParam } from "#/features/motionTransfer/server/generate";

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
