import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useCallback } from "react";

import { composerSlots } from "#/app/composer-slots";
import { loadSelection } from "#/features/motionTransfer/selection.functions";
import { PresetPage } from "#/features/presets/components/preset-page";
import { type PresetSearch, presetSearchSchema } from "#/features/presets/draft";
import { loadPreset } from "#/features/presets/presets.functions";
import { Problem } from "#/shared/components/problem";

// The look and seed are not loader dependencies: editing them reuses the page's data.
export const Route = createFileRoute("/presets/$presetId")({
  validateSearch: presetSearchSchema,
  loaderDeps: ({ search }) => ({ character: search.character }),
  loader: async ({ deps, params }) => {
    const [view, selection] = await Promise.all([
      loadPreset({ data: { id: params.presetId } }),
      loadSelection({ data: { character: deps.character } }),
    ]);

    if (!view) {
      throw notFound();
    }

    return { selection, view };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.view.preset.title} · Motion presets · Open Photon`
          : "Motion presets · Open Photon",
      },
    ],
  }),
  component: Preset,
  notFoundComponent: () => (
    <Problem title="Preset not found">
      <Link className="underline underline-offset-3" to="/presets">
        See every preset
      </Link>
    </Problem>
  ),
});

function Preset() {
  const { selection, view } = Route.useLoaderData();
  const navigate = Route.useNavigate();

  const onSearch = useCallback(
    (next: Partial<PresetSearch>) =>
      void navigate({ replace: true, search: (current) => ({ ...current, ...next }) }),
    [navigate],
  );

  return (
    <PresetPage
      characterPicker={composerSlots.characterPicker}
      directionEditor={composerSlots.directionEditor}
      key={view.preset.id}
      onSearch={onSearch}
      search={Route.useSearch()}
      selection={selection}
      view={view}
    />
  );
}
