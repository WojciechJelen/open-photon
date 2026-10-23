import { createFileRoute } from "@tanstack/react-router";

import { composerSlots } from "#/app/composer-slots";
import { MotionTransferWizard } from "#/features/motionTransfer/components/motion-transfer-wizard";
import { motionTransferDraftSchema } from "#/features/motionTransfer/draft";
import { loadSelection } from "#/features/motionTransfer/selection.functions";

// The step is not a loader dependency: moving between steps reuses the picks' data.
export const Route = createFileRoute("/motionTransfer")({
  validateSearch: motionTransferDraftSchema,
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
  return (
    <MotionTransferWizard
      characterPicker={composerSlots.characterPicker}
      directionEditor={composerSlots.directionEditor}
      draft={Route.useSearch()}
      generationActions={composerSlots.directGenerationActions}
      selection={Route.useLoaderData()}
    />
  );
}
