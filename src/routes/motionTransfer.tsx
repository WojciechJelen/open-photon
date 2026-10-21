import { createFileRoute } from "@tanstack/react-router";

import { MotionTransferWizard } from "#/features/motionTransfer/components/motion-transfer-wizard";
import { loadSelection } from "#/features/motionTransfer/selection.functions";
import { wizardSearchSchema } from "#/features/motionTransfer/wizard";

// The step is not a loader dependency: moving between steps reuses the picks' data.
export const Route = createFileRoute("/motionTransfer")({
  validateSearch: wizardSearchSchema,
  loaderDeps: ({ search }) => ({
    character: search.character,
    from: search.from,
    motion: search.motion,
  }),
  loader: ({ deps }) => loadSelection({ data: deps }),
  head: () => ({ meta: [{ title: "Motion Transfer · Open Photon" }] }),
  component: MotionTransfer,
});

function MotionTransfer() {
  const search = Route.useSearch();

  // Keyed by `from`: another take's direction starts the Direct step afresh.
  return (
    <MotionTransferWizard
      key={search.from ?? ""}
      search={search}
      selection={Route.useLoaderData()}
    />
  );
}
