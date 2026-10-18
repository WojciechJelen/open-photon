import { createFileRoute } from "@tanstack/react-router";

import { checkComfySdk } from "#/server/comfy.server";

export const Route = createFileRoute("/api/spike/comfy")({
  server: {
    handlers: {
      GET: () => {
        if (process.env.ENABLE_SPIKE_CHECKS !== "1") {
          return new Response(null, { status: 404 });
        }

        return checkComfySdk();
      },
    },
  },
});
