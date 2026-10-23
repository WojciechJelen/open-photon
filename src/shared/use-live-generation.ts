import { useEffect, useState } from "react";
import { z } from "zod";

import { generationEventSchema, type GenerationSnapshot } from "#/shared/contracts";

const finished: ReadonlySet<GenerationSnapshot["status"]> = new Set([
  "done",
  "failed",
  "unknown",
  "cancelled",
]);

/** Whether a generation in `status` has finished: its event stream sends nothing more. */
export function isFinished(status: GenerationSnapshot["status"]) {
  return finished.has(status);
}

/**
 * A generation as its event stream (`GET /api/generations/:id/events`) reports it, from
 * `initial` until it is done, failed, unknown or cancelled (a `done` one with its outputs,
 * `generationSchema`), and whether the stream last said Comfy could not be asked
 * (`provider_unavailable`; the browser reconnects on its own after the server's `retry:` delay).
 * Whatever workflow made it; a finished `initial` opens no stream.
 */
export function useLiveGeneration(initial: GenerationSnapshot) {
  const [generation, setGeneration] = useState(initial);
  const [providerUnavailable, setProviderUnavailable] = useState(false);

  useEffect(() => {
    if (finished.has(initial.status)) {
      return;
    }

    const events = new EventSource(`/api/generations/${initial.id}/events`);

    events.addEventListener("message", (event) => {
      const update = generationEventSchema.parse(JSON.parse(z.string().parse(event.data)));

      setGeneration(update.generation);
      setProviderUnavailable(update.kind === "provider_unavailable");

      // The server ends the stream after a final snapshot; closing stops EventSource reconnecting.
      if (finished.has(update.generation.status)) {
        events.close();
      }
    });

    return () => events.close();
  }, [initial.id, initial.status]);

  return { generation, providerUnavailable };
}
