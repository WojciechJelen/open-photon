import { createFileRoute } from "@tanstack/react-router";

import { PhotoshootStudio } from "#/features/photoshoot/components/photoshoot-studio";

export const Route = createFileRoute("/photoshoot/")({
  head: () => ({ meta: [{ title: "Photoshoot · Open Photon" }] }),
  component: PhotoshootStudio,
});
