import { cn } from "cn";
import { ImageOffIcon } from "lucide-react";
import { useState } from "react";

import type { PickableCharacter } from "#/features/characters/contracts";
import { isTaggedGenerated } from "#/features/characters/library";
import { mediaUrl } from "#/shared/media";

/**
 * A character's reference image, filling its positioned frame. A generated one (a sample or a
 * builder render, a FLUX Kommunity output) says it is AI-generated in its alt text, and one saved
 * from the builder in a tag on the picture too, off the head: at the `bottom` of a tile, or above
 * the `row` of actions along a card's bottom edge. When the image does not load (its file is gone, or the visitor may no longer see it), a placeholder says
 * so; the character stays renameable and selectable.
 */
export function CharacterImage({
  character,
  tag,
}: {
  character: PickableCharacter;
  tag: "bottom" | "row";
}) {
  const [failed, setFailed] = useState<string | null>(null);

  if (failed === character.image.id) {
    return (
      <span
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-screen px-2 text-center text-muted-foreground"
        data-image-state="missing"
      >
        <ImageOffIcon aria-hidden="true" className="size-6" strokeWidth={1.75} />
        <span className="type-hint">Image unavailable</span>
      </span>
    );
  }

  return (
    <>
      <img
        alt={character.origin === "generated" ? "AI-generated image" : ""}
        className="absolute inset-0 size-full object-cover"
        decoding="async"
        loading="lazy"
        onError={() => setFailed(character.image.id)}
        src={mediaUrl(character.image)}
      />
      {isTaggedGenerated(character) && (
        <span
          className={cn(
            "absolute rounded-tag bg-background/66 py-0.75 type-tag whitespace-nowrap text-foreground",
            // A tile of a phone's row is 96 px wide: the tag fits with less around it.
            tag === "row"
              ? "bottom-14 left-2 px-1.75"
              : "bottom-2 left-2 px-1.75 max-sm:bottom-1 max-sm:left-1 max-sm:px-1",
          )}
        >
          AI-generated
        </span>
      )}
    </>
  );
}
