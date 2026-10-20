import { createFileRoute } from "@tanstack/react-router";

import { generationIdParam } from "#/server/generate";
import { findGeneration } from "#/server/generations";

/** The generation's stored recipe (`recipeSchema`): what made it, and what a re-run submits again. */
export const Route = createFileRoute("/api/generations/$generationId/recipe.json")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const id = generationIdParam(params.generationId);

        if (id instanceof Response) {
          return id;
        }

        const row = findGeneration(id);

        return row
          ? Response.json(row.recipe)
          : Response.json({ error: "Generation not found" }, { status: 404 });
      },
    },
  },
});
