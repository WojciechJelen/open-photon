import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * The picker's data for the ids in the URL of `/`, and whether the visitor has an access session;
 * see `readSelection`. Public: the picker is open without a code.
 */
export const loadSelection = createServerFn({ method: "GET" })
  .validator(z.object({ character: z.uuid().optional(), motion: z.uuid().optional() }))
  .handler(async ({ data }) => {
    // Loaded on the server only: a static import would pull SQLite into the client bundle.
    const { getRequest } = await import("@tanstack/react-start/server");
    const { readSession } = await import("#/shared/server/access.server");
    const { readSelection } = await import("#/features/genjutsu/server/selection");

    return readSelection(data, readSession(getRequest()) !== null);
  });
