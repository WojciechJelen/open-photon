import { createFileRoute } from "@tanstack/react-router";

import { BatchHistory } from "#/features/batches/components/batch-history";

export const Route = createFileRoute("/batches/")({
  head: () => ({ meta: [{ title: "Batches · Motion Transfer · Open Photon" }] }),
  component: BatchHistory,
});
