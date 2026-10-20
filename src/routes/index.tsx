import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CharacterGrid } from "#/components/character-grid";
import { CharacterUpload } from "#/components/character-upload";
import { GenerateForm } from "#/components/generate-form";
import { LoopingVideo } from "#/components/looping-video";
import { MotionGrid } from "#/components/motion-grid";
import { UploadZone } from "#/components/upload-zone";
import { mediaUrl } from "#/lib/media";
import { loadSelection } from "#/lib/selection.functions";

// An id that is not a UUID is dropped, so a mangled link falls back to no choice.
const searchSchema = z.object({
  motion: z.uuid().optional().catch(undefined),
  character: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ character: search.character, motion: search.motion }),
  loader: ({ deps }) => loadSelection({ data: deps }),
  component: Home,
});

function Home() {
  const { angles, character, characters, motion, motions, placeholderAngles } =
    Route.useLoaderData();

  const navigate = Route.useNavigate();

  const pickMotion = (assetId: string) =>
    navigate({ search: (previous) => ({ ...previous, motion: assetId }) });

  const pickCharacter = (characterId: string) =>
    navigate({ search: (previous) => ({ ...previous, character: characterId }) });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Open Photon</h1>
        <p className="text-muted-foreground">
          Pick a motion, pick a character, and watch the character perform it.
        </p>
      </header>

      <section aria-labelledby="motion-heading" className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold" id="motion-heading">
          1. Motion
        </h2>
        <MotionGrid motions={motions} onPick={pickMotion} selectedAssetId={motion?.id} />
        <UploadZone onReady={pickMotion} selectedAssetId={motion?.id} />
        {motion ? (
          <div aria-label="Chosen motion" className="flex max-w-40 flex-col gap-2" role="group">
            <LoopingVideo label="Chosen motion" src={mediaUrl(motion)} />
            <p className="text-sm">
              Chosen motion, {((motion.duration_ms ?? 0) / 1000).toFixed(1)} s
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No motion chosen yet.</p>
        )}
      </section>

      <section aria-labelledby="character-heading" className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold" id="character-heading">
          2. Character
        </h2>
        <CharacterGrid characters={characters} onPick={pickCharacter} selectedId={character?.id} />
        <CharacterUpload onReady={pickCharacter} selectedId={character?.id} />
        {character ? (
          <div aria-label="Chosen character" className="flex max-w-40 flex-col gap-2" role="group">
            <img
              alt=""
              className="aspect-3/4 w-full rounded-md bg-muted object-cover"
              src={mediaUrl(character.image)}
            />
            <p className="text-sm">Chosen character: {character.title ?? "your photo"}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No character chosen yet.</p>
        )}
      </section>

      <section aria-labelledby="generate-heading" className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold" id="generate-heading">
          3. Generate
        </h2>
        <GenerateForm
          angles={angles}
          characterId={character?.id}
          motionAssetId={motion?.id}
          placeholderAngles={placeholderAngles}
        />
      </section>
    </main>
  );
}
