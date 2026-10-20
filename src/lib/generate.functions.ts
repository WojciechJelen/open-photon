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

/**
 * What `/g/:id` shows, and the origin its share link starts with; `null` for an id that names no
 * generation. See `readResult`.
 */
export const loadResult = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data }) => {
    const { readResult } = await import("#/server/generate");
    const { publicOrigin } = await import("#/server/share");
    const result = await readResult(data);

    return result && { ...result, origin: publicOrigin() };
  });

/** What the share page `/r/:slug` shows; `null` for a slug no done generation has. See `readShare`. */
export const loadShare = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data }) => {
    const { publicOrigin, readShare } = await import("#/server/share");

    return readShare(data, publicOrigin());
  });
