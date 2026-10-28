import { createFileRoute } from "@tanstack/react-router";

import { AnimatePage } from "#/features/animateImage/components/animate-page";
import { animateSearchSchema } from "#/features/animateImage/contracts";

export const Route = createFileRoute("/animate")({
  validateSearch: animateSearchSchema,
  head: () => ({ meta: [{ title: "Animate an image · Open Photon" }] }),
  component: AnimateRoute,
});

function AnimateRoute() {
  return <AnimatePage search={Route.useSearch()} />;
}
