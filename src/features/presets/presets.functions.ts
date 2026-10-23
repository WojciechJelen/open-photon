import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** The gallery `/presets`: every preset with its availability (`readPresets`). Public. */
export const loadPresets = createServerFn({ method: "GET" }).handler(async () => {
  // Loaded on the server only: a static import would pull SQLite into the client bundle.
  const { readPresets } = await import("#/features/presets/server/catalog");

  return readPresets();
});

/** One preset's page: the preset with its availability, `null` for an unknown id. Public. */
export const loadPreset = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().max(80) }))
  .handler(async ({ data }) => {
    // Server only, as above.
    const { readPreset } = await import("#/features/presets/server/catalog");

    return readPreset(data.id);
  });
