import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// This file is in the client bundle too: server modules are imported inside `.server()` only,
// where the compiler strips them from the client, since a static import would pull in SQLite.
const access = createMiddleware().server(async ({ request, next }) => {
  const { accessGuard } = await import("#/shared/server/access.server");
  const denied = await accessGuard(request);

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

  // Share pages and the files they show may be indexed; nothing else.
  const { isIndexable } = await import("#/features/motionTransfer/server/public-access");

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
