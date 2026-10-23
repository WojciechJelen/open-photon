import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// The server modules are loaded on the server only: a static import would pull SQLite into the
// client bundle. Both functions are public (`exploreAccess`): they read what anyone may see.

/** The gallery `/explore`: every curated example (`listExamples`). */
export const loadExplore = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { listExamples } = await import("#/features/explore/server/catalog");
  const { publicOrigin } = await import("#/shared/server/public-origin");

  return listExamples(publicOrigin(getRequest().url));
});

/** An example's page `/explore/:slug` (`readExampleBySlug`); `null` for no such example. */
export const loadExample = createServerFn({ method: "GET" })
  .validator(z.string())
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { readExampleBySlug } = await import("#/features/explore/server/catalog");
    const { publicOrigin } = await import("#/shared/server/public-origin");

    return readExampleBySlug(data, publicOrigin(getRequest().url));
  });
