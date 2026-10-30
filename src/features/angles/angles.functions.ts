import { createServerFn } from "@tanstack/react-start";

/**
 * The workspace's latest angle sets, for the page's first paint (`listAngleSets`). Not public: a
 * visitor without a session is refused, as `GET /api/angle-sets` refuses them.
 */
export const loadAngleSets = createServerFn({ method: "GET" }).handler(async () => {
  // Loaded on the server only: a static import would pull SQLite into the client bundle.
  const { listAngleSets } = await import("#/features/angles/server/angle-sets");

  return listAngleSets();
});
