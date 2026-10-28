import { createFileRoute } from "@tanstack/react-router";

import { StoryboardHome } from "#/features/storyboard/components/storyboard-home";

export const Route = createFileRoute("/storyboards/")({
  head: () => ({ meta: [{ title: "Storyboards · Open Photon" }] }),
  component: StoryboardHome,
});
