import { createFileRoute } from "@tanstack/react-router";

import { AngleSetPage } from "#/features/angles/components/angle-set-page";

export const Route = createFileRoute("/angles/$angleSetId")({
  head: () => ({ meta: [{ title: "Angle set · Shots & Angles · Open Photon" }] }),
  component: AngleSet,
});

function AngleSet() {
  const { angleSetId } = Route.useParams();

  // Keyed by id: another set is another page, with reads of its own.
  return <AngleSetPage angleSetId={angleSetId} key={angleSetId} />;
}
