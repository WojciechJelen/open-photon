import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

import goldenHourRooftop from "#/shared/assets/access/golden-hour-rooftop.webp?inline";
import neonNight from "#/shared/assets/access/neon-night.webp?inline";
import streetDance from "#/shared/assets/access/street-dance.webp?inline";

import appCss from "./styles.css?url";

// What the access page, rendered without React, loads. The stills are data URLs: only the server
// code below uses them, which the client build strips, so as files they would never be emitted.
const accessArt = { stills: [streetDance, neonNight, goldenHourRooftop], stylesheet: appCss };

// This file is in the client bundle too: server modules are imported inside `.server()` only,
// where the compiler strips them from the client, since a static import would pull in SQLite.
const access = createMiddleware().server(async ({ request, next }) => {
  const { accessGuard } = await import("#/shared/server/access.server");
  const denied = await accessGuard(request, accessArt);

  if (denied) {
    return denied;
  }

  const result = await next();

  // An event stream keeps its own `no-cache, no-transform`, the header proxies key on to stream
  // it unbuffered, and `/media/*` its own year-long `immutable` (an asset never changes; it says
  // itself whether shared caches may keep it). Everything else behind the access code is private.
  const cacheControl = result.response.headers.get("Cache-Control");

  if (
    !result.response.headers.get("Content-Type")?.startsWith("text/event-stream") &&
    !cacheControl?.includes("immutable")
  ) {
    result.response.headers.set("Cache-Control", "private, no-store, no-transform");
  }

  // Share pages and the files they show may be indexed; nothing else (`src/app/server.ts`).
  const { isIndexable } = await import("#/app/server");

  if (!isIndexable(new URL(request.url).pathname)) {
    result.response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return result;
});

// Every server function call, over `/_serverFn/*` or from a page's loader on the server, passes
// here: anonymous callers reach only the public ones (`serverFnRefusal`).
const serverFnAccess = createMiddleware({ type: "function" }).server(
  async ({ next, serverFnMeta }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { serverFnRefusal } = await import("#/shared/server/access.server");
    const refused = serverFnRefusal(getRequest(), serverFnMeta);

    if (refused) {
      throw refused;
    }

    return next();
  },
);

export const startInstance = createStart(() => ({
  functionMiddleware: [serverFnAccess],
  requestMiddleware: [
    createCsrfMiddleware({
      filter: ({ request }) => !["GET", "HEAD", "OPTIONS"].includes(request.method),
      allowRequestsWithoutOriginCheck: true,
    }),
    access,
  ],
}));
