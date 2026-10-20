import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

const access = createMiddleware().server(async ({ request, next }) => {
  const { accessGuard } = await import("#/server/access.server");
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

  result.response.headers.set("X-Robots-Tag", "noindex, nofollow");

  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({
      filter: ({ request }) => !["GET", "HEAD", "OPTIONS"].includes(request.method),
      allowRequestsWithoutOriginCheck: true,
    }),
    access,
  ],
}));
