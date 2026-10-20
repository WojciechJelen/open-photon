import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * The wizard's data for the ids in the URL of `/genjutsu`, and whether the visitor has an access
 * session; see `readSelection`. Public: the wizard is open without a code.
 */
export const loadSelection = createServerFn({ method: "GET" })
  .validator(
    z.object({
      character: z.uuid().optional(),
      from: z.uuid().optional(),
      motion: z.uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    // Loaded on the server only: a static import would pull SQLite into the client bundle.
    const { getRequest } = await import("@tanstack/react-start/server");
    const { readSession } = await import("#/shared/server/access.server");
    const { readSelection } = await import("#/features/genjutsu/server/selection");

    return readSelection(data, readSession(getRequest()) !== null);
  });

/** What the studio home shows; see `readStudio`. Public, like the samples it shows. */
export const loadStudio = createServerFn({ method: "GET" }).handler(async () => {
  const { readStudio } = await import("#/features/genjutsu/server/selection");

  return readStudio();
});
