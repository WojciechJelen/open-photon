import { createFileRoute } from "@tanstack/react-router";

import { PresetGallery } from "#/features/presets/components/preset-gallery";
import { loadPresets } from "#/features/presets/presets.functions";

export const Route = createFileRoute("/presets/")({
  loader: () => loadPresets(),
  head: () => ({ meta: [{ title: "Motion presets · Open Photon" }] }),
  component: Presets,
});

function Presets() {
  return <PresetGallery presets={Route.useLoaderData()} />;
}
