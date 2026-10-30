import { cn } from "cn";
import { LoaderCircleIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { readGeneration, readLibrary } from "#/features/animateImage/animate-client";
import type { AnimationSource } from "#/features/animateImage/contracts";
import type { CharacterSummary } from "#/features/characters";
import { AddTile, PictureTile } from "#/shared/components/picture-tile";
import type { Asset } from "#/shared/contracts";
import { IMAGE_UPLOAD_TYPES, uploadImageFile } from "#/shared/image-upload";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";

/**
 * The image an animation starts from, as the page shows it. `generated` is how an AI-generated one
 * says so: a result or a character saved from the builder is `tagged` on the picture, a `sample` in
 * its alt text; an upload is `null`.
 */
export type PickedSource = {
  generated: "sample" | "tagged" | null;
  image: Asset;
  label: string;
  source: AnimationSource;
};

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
      ? { picked: { generated: "tagged", image: output.asset, label: "Your result", source } }
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
    generated: character.origin !== "generated" ? null : character.is_sample ? "sample" : "tagged",
    image: character.image,
    label: character.title ?? "Library character",
    source: { character_id: character.id, kind: "character" },
  };
}

// A phone scrolls the tiles in one row, 96 px each; a wider screen wraps them in a grid.
const tileWidth = "w-24 shrink-0 sm:w-full";

const placeholders = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** What a tile says to assistive technology: the button's name replaces the picture's alt text. */
function tileText(name: string, generated: boolean) {
  const alt = generated ? "AI-generated image" : "";

  return { alt, "aria-label": alt ? `Animate ${name}, ${alt}` : `Animate ${name}` };
}

/** The first tile's box while it has no picture: dashed, as `AddTile`'s, in `tone`. */
function TileState({ children, tone }: { children: ReactNode; tone: "busy" | "warning" }) {
  return (
    <span
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-2 text-center",
        tone === "busy" && "border-brand/50 bg-background text-brand-foreground",
        tone === "warning" && "border-warning/50 bg-warning/5 text-warning",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Where the source comes from: an image uploaded here (any subject: a product, an animal, a
 * scene, a person; `POST /api/image-uploads`) or a character of the workspace library, samples
 * included. The first tile holds the upload through all its states, and then its picture (or a
 * result handed over by link) with a way to replace it, so the tiles after it never move.
 * `onRefused` gets a refusal the page handles (the access code).
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
  const input = useRef<HTMLInputElement>(null);
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [own, setOwn] = useState<PickedSource | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // What did not come from the library stays on the first tile once a character is picked instead.
  if (picked && picked.source.kind !== "character" && picked !== own) {
    setOwn(picked);
  }

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

  function pick(source: PickedSource) {
    setProblem(null);
    onPick(source);
  }

  async function upload(file: File) {
    setUploading(true);
    setProblem(null);

    const answer = await uploadImageFile(file);

    setUploading(false);

    if ("data" in answer) {
      onPick({
        generated: null,
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

  const browse = () => input.current?.click();

  function firstTile() {
    if (uploading) {
      return (
        <PictureTile caption="Uploading…" className={tileWidth} disabled pressed={false}>
          <TileState tone="busy">
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-5 motion-safe:animate-spin"
              strokeWidth={1.75}
            />
          </TileState>
        </PictureTile>
      );
    }

    if (problem) {
      return (
        <PictureTile
          aria-label="Add a photo"
          caption="Try another"
          className={tileWidth}
          onClick={browse}
          pressed={false}
        >
          <TileState tone="warning">
            <TriangleAlertIcon aria-hidden="true" className="size-5" strokeWidth={1.75} />
            <span
              className="line-clamp-5 type-hint wrap-anywhere text-soft-foreground"
              title={problem}
            >
              {problem}
            </span>
          </TileState>
        </PictureTile>
      );
    }

    if (own) {
      return (
        <div className={cn("relative min-w-0", tileWidth)}>
          <PictureTile
            {...tileText(own.label, own.generated !== null)}
            caption={own.label}
            onClick={() => pick(own)}
            pressed={own.source === picked?.source}
            src={mediaUrl(own.image)}
            tagged={own.generated === "tagged"}
          />
          <span className="absolute top-1.5 left-1.5">
            <Button aria-label="Replace the photo" onClick={browse} size="icon" variant="scrim">
              <UploadIcon aria-hidden="true" />
            </Button>
          </span>
        </div>
      );
    }

    return <AddTile caption="Add a photo" className={tileWidth} onClick={browse} />;
  }

  return (
    <>
      <input
        accept={IMAGE_UPLOAD_TYPES.join(",")}
        aria-label="Image to animate"
        className="sr-only"
        disabled={uploading}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];

          event.currentTarget.value = "";

          if (file) {
            void upload(file);
          }
        }}
        ref={input}
        tabIndex={-1}
        type="file"
      />
      {problem && (
        <p className="sr-only" role="alert">
          {problem}
        </p>
      )}
      {characters === null && (
        <p className="sr-only" role="status">
          Loading the library…
        </p>
      )}
      <div
        aria-label="Characters"
        className="-mr-4 -ml-1 flex gap-2.5 overflow-x-auto py-1 pr-4 pl-1 sm:m-0 sm:grid sm:grid-fill-28 sm:gap-3 sm:overflow-visible sm:p-0"
        role="group"
      >
        {firstTile()}
        {characters === null
          ? placeholders.map((key) => (
              <span aria-hidden="true" className={cn("flex flex-col gap-2", tileWidth)} key={key}>
                <span className="block aspect-4/7 skeleton rounded-lg" />
                <span className="block h-4.75" />
              </span>
            ))
          : characters.map((character) => {
              const name =
                character.title ??
                (character.origin === "upload" ? "Untitled photo" : "Untitled character");

              return (
                <PictureTile
                  {...tileText(name, character.origin === "generated")}
                  caption={name}
                  className={tileWidth}
                  key={character.id}
                  onClick={() => pick(pickedCharacter(character))}
                  pressed={
                    picked?.source.kind === "character" &&
                    picked.source.character_id === character.id
                  }
                  src={mediaUrl(character.image)}
                  tagged={character.origin === "generated" && !character.is_sample}
                />
              );
            })}
      </div>
    </>
  );
}
