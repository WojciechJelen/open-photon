import { createServerFn } from "@tanstack/react-start";

import { generateInputSchema } from "#/lib/contracts";

/** Starts a generation, or returns the one with the same recipe; see `generateInputSchema`. */
export const generate = createServerFn({ method: "POST" })
  .validator(generateInputSchema)
  .handler(async ({ data }) => {
    // Loaded on the server only: a static import would pull SQLite and the SDK into the client bundle.
    const { generate: start } = await import("#/server/generate");

    return start(data);
  });
