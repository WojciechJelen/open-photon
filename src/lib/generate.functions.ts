import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// The server modules are loaded on the server only: a static import would pull SQLite and the
// SDK into the client bundle.

/**
 * What `/g/:id` shows, and the origin its share link starts with; `null` for an id that names no
 * generation. See `readResult`. Server functions pass the access guard, so this checks access
 * itself: a generation's page needs a session unless it is a pre-rendered sample; without one,
 * the browser goes to the code form, which returns to the page.
 */
export const loadResult = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { readSession } = await import("#/server/access.server");
    const { accessUrl } = await import("#/server/access-page.server");
    const { readResult } = await import("#/server/generate");
    const { publicOrigin } = await import("#/server/share");
    const result = readResult(data);

    if (result && !result.prerendered && !readSession(getRequest())) {
      throw redirect({ href: accessUrl(`/g/${result.generation.id}`), reloadDocument: true });
    }

    return result && { ...result, origin: publicOrigin() };
  });

/** What the share page `/r/:slug` shows; `null` for a slug no done generation has. See `readShare`. */
export const loadShare = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data }) => {
    const { publicOrigin, readShare } = await import("#/server/share");

    return readShare(data, publicOrigin());
  });
