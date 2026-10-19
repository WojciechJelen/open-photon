import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { generateInputSchema } from "#/lib/contracts";

// The server modules are loaded on the server only: a static import would pull SQLite and the
// SDK into the client bundle.

/** Starts a generation, or returns the one with the same recipe; see `generateInputSchema`. */
export const generate = createServerFn({ method: "POST" })
  .validator(generateInputSchema)
  .handler(async ({ data }) => {
    const { generate: start } = await import("#/server/generate");

    return start(data);
  });

/** What `/g/:id` shows; `null` for an id that names no generation. See `readResult`. */
export const loadResult = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data }) => {
    const { readResult } = await import("#/server/generate");

    return readResult(data);
  });
