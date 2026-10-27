import { ImageUpIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "#/components/ui/button";
import { readGeneration, readLibrary } from "#/features/animateImage/animate-client";
import type { AnimationSource } from "#/features/animateImage/contracts";
import type { CharacterSummary } from "#/features/characters";
import type { Asset } from "#/shared/contracts";
import { IMAGE_UPLOAD_TYPES, uploadImageFile } from "#/shared/image-upload";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";

/** The image an animation starts from, as the page shows it. */
export type PickedSource = { image: Asset; label: string; source: AnimationSource };

/**
 * The source a link preselects (`?generation=…&output=…` or `?character=…`), read once: the
 * generation's image output (it must be done and have it) or the library character; a refusal
 * says why it cannot be animated.
 */
export async function readPreselected(
  source: AnimationSource,
): Promise<{ picked: PickedSource } | { problem: string; refusal?: Refusal }> {
  if (source.kind === "upload") {
    return { problem: "An upload cannot be preselected." };
  }

  if (source.kind === "generation") {
    const answer = await readGeneration(source.generation_id);

    if ("refusal" in answer) {
      return { problem: answer.refusal.message, refusal: answer.refusal };
    }

    if (answer.data.status !== "done") {
      return { problem: `That result is ${answer.data.status}; animate it once it is done.` };
    }

    const output = answer.data.outputs.find(({ name }) => name === source.output);

    return output?.media === "image"
      ? { picked: { image: output.asset, label: "Your result", source } }
      : { problem: `That result has no image "${source.output}" to animate.` };
  }

  const answer = await readLibrary();

  if ("refusal" in answer) {
    return { problem: answer.refusal.message, refusal: answer.refusal };
  }

  const character = answer.data.characters.find(({ id }) => id === source.character_id);

  return character
    ? { picked: pickedCharacter(character) }
    : { problem: "That character is not in the library." };
}

function pickedCharacter(character: CharacterSummary): PickedSource {
  return {
    image: character.image,
    label: character.title ?? "Library character",
    source: { character_id: character.id, kind: "character" },
  };
}

/**
 * Where the source comes from: an image uploaded here (any subject: a product, an animal, a
 * scene, a person; `POST /api/image-uploads`) or a character of the workspace library, samples
 * included. `onRefused` gets a refusal the page handles (the access code).
 */
export function SourcePicker({
  onPick,
  onRefused,
  picked,
}: {
  onPick: (picked: PickedSource) => void;
  onRefused: (refusal: Refusal, resume: () => void) => void;
  picked: PickedSource | null;
}) {
  const id = useId();
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;

    void readLibrary().then((answer) => {
      if (stopped) {
        return;
      }

      if ("data" in answer) {
        setCharacters(answer.data.characters);
      } else {
        onRefused(answer.refusal, () => setAttempt((count) => count + 1));
      }
    });

    return () => {
      stopped = true;
    };
  }, [attempt, onRefused]);

  async function upload(file: File) {
    setUploading(true);
    setProblem(null);

    const answer = await uploadImageFile(file);

    setUploading(false);

    if ("data" in answer) {
      onPick({
        image: answer.data,
        label: file.name,
        source: { asset_id: answer.data.id, kind: "upload" },
      });
    } else if (answer.refusal.reason === "access_required") {
      onRefused(answer.refusal, () => void upload(file));
    } else {
      setProblem(answer.refusal.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild disabled={uploading} variant="outline">
          <label htmlFor={`${id}-file`}>
            <ImageUpIcon />
            {uploading ? "Uploading…" : "Upload an image"}
          </label>
        </Button>
        <input
          accept={IMAGE_UPLOAD_TYPES.join(",")}
          aria-label="Image to animate"
          className="sr-only"
          disabled={uploading}
          id={`${id}-file`}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];

            event.currentTarget.value = "";

            if (file) {
              void upload(file);
            }
          }}
          type="file"
        />
        <span className="text-sm text-muted-foreground">PNG, JPEG or WebP, up to 25 MiB.</span>
      </div>
      {problem && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {problem}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium" id={`${id}-library`}>
          Or pick a character from the library
        </h3>
        {characters === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading the library…
          </p>
        ) : (
          <ul aria-labelledby={`${id}-library`} className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {characters.map((character) => {
              const selected =
                picked?.source.kind === "character" && picked.source.character_id === character.id;

              const name = character.title ?? "Untitled character";

              return (
                <li key={character.id}>
                  <button
                    aria-label={`Animate ${name}`}
                    aria-pressed={selected}
                    className="relative block aspect-3/4 w-full overflow-hidden rounded-xl border bg-screen outline-offset-2 aria-pressed:border-brand aria-pressed:ring-2 aria-pressed:ring-brand"
                    onClick={() => onPick(pickedCharacter(character))}
                    type="button"
                  >
                    <img
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      src={mediaUrl(character.image)}
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/70 px-1.5 pt-3 pb-1 text-left text-xs text-white">
                      {name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
