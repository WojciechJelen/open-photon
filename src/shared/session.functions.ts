import { createServerFn } from "@tanstack/react-start";

/**
 * What the site header shows on the server's first paint: the session's allowance, `null` without
 * a session. Public (`sessionAccess`): anyone may ask whether they have one.
 */
export const loadSession = createServerFn({ method: "GET" }).handler(async () => {
  // Loaded on the server only: a static import would pull the session store into the client.
  const { getRequest } = await import("@tanstack/react-start/server");
  const { sessionStatus } = await import("#/shared/server/access.server");

  return sessionStatus(getRequest());
});
