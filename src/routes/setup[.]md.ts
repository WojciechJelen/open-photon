import { createFileRoute } from "@tanstack/react-router";

import { setupInstructions } from "#/app/setup.server";

export const Route = createFileRoute("/setup.md")({
  server: {
    handlers: {
      GET: () =>
        new Response(setupInstructions, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    },
  },
});
