import { once } from "node:events";

import { createFileRoute } from "@tanstack/react-router";

import { eventStream } from "#/server/generation-stream";

/**
 * With `ENABLE_DEBUG=1` only (else a 404): an event stream that sends an opening comment, then
 * nothing but the heartbeat until the client closes it. It goes through a generation stream's own
 * writer, headers and heartbeat (`eventStream`), so it shows whether a proxy keeps such a stream
 * open longer than any generation takes.
 */
export const Route = createFileRoute("/api/debug/heartbeat")({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (process.env.ENABLE_DEBUG !== "1") {
          return new Response(null, { status: 404 });
        }

        return eventStream(request, async function* (signal) {
          yield ": open\n\n";
          await once(signal, "abort");
        });
      },
    },
  },
});
