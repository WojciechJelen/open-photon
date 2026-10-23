import { createFileRoute } from "@tanstack/react-router";

import { handlePresetGenerate } from "#/features/presets/server/generate";

export const Route = createFileRoute("/api/presets/$presetId/generations")({
  server: {
    handlers: { POST: ({ params, request }) => handlePresetGenerate(request, params.presetId) },
  },
});
