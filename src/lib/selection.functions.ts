import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** The picker's data for the ids in the URL of `/`; see `readSelection`. */
export const loadSelection = createServerFn({ method: "GET" })
  .validator(z.object({ motion: z.uuid().optional() }))
  .handler(async ({ data }) => {
    // Loaded on the server only: a static import would pull SQLite into the client bundle.
    const { readSelection } = await import("#/server/selection");

    return readSelection(data);
  });
