import { createFileRoute } from "@tanstack/react-router";

import { BatchPage } from "#/features/batches/components/batch-page";

export const Route = createFileRoute("/batches/$batchId")({
  head: () => ({ meta: [{ title: "Batch · Motion Transfer · Open Photon" }] }),
  component: Batch,
});

function Batch() {
  const { batchId } = Route.useParams();

  // Keyed by id: another batch is another page, with reads of its own.
  return <BatchPage batchId={batchId} key={batchId} />;
}
