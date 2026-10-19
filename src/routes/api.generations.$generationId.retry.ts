import { createFileRoute } from "@tanstack/react-router";

import { GenerateError, retry, generationIdParam } from "#/server/generate";

export const Route = createFileRoute("/api/generations/$generationId/retry")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const id = generationIdParam(params.generationId);

        if (id instanceof Response) {
          return id;
        }

        try {
          const result = await retry(id);

          return Response.json(result, { status: result.reused ? 200 : 201 });
        } catch (error) {
          if (error instanceof GenerateError) {
            return Response.json({ error: error.message }, { status: error.status });
          }

          throw error;
        }
      },
    },
  },
});
