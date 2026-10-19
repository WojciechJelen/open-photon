import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { readGeneration } from "#/server/generate";

export const Route = createFileRoute("/api/generations/$generationId")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const id = z.uuid().safeParse(params.generationId);

        if (!id.success) {
          return Response.json({ error: "Invalid generation ID" }, { status: 400 });
        }

        const generation = readGeneration(id.data);

        return generation
          ? Response.json(generation)
          : Response.json({ error: "Generation not found" }, { status: 404 });
      },
    },
  },
});
