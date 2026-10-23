import { createServerFn } from "@tanstack/react-start";

/**
 * Whether the visitor has an access session, for the builder's access status and its first
 * request. Public (`characterBuilderAccess`): a page opened without a session is refused before
 * it renders, but a visitor can still arrive by a link inside the app, and is then told the
 * builder needs the code instead of seeing it as active.
 */
export const loadBuilderAccess = createServerFn({ method: "GET" }).handler(async () => {
  // Loaded on the server only: a static import would pull the session store into the client.
  const { getRequest } = await import("@tanstack/react-start/server");
  const { readSession } = await import("#/shared/server/access.server");

  return { signedIn: readSession(getRequest()) !== null };
});
