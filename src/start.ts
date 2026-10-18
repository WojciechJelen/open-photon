import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

const access = createMiddleware().server(async ({ request, next }) => {
  const { accessGuard } = await import("#/server/access.server");
  const denied = await accessGuard(request);

  if (denied) {
    return denied;
  }

  const result = await next();
  result.response.headers.set("Cache-Control", "private, no-store, no-transform");
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
