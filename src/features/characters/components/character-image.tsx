import { ImageOffIcon } from "lucide-react";
import { useState } from "react";

import type { PickableCharacter } from "#/features/characters/contracts";
import { mediaUrl } from "#/shared/media";

/**
 * A character's reference image, filling its positioned frame. When the image does not load (its
 * file is gone, or the visitor may no longer see it), a placeholder says so; the character stays
 * renameable and selectable.
 */
export function CharacterImage({ character }: { character: PickableCharacter }) {
  const [failed, setFailed] = useState<string | null>(null);

  if (failed === character.image.id) {
    return (
      <span
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-screen text-muted-foreground"
        data-image-state="missing"
      >
        <ImageOffIcon aria-hidden="true" className="size-7" />
        <span className="text-xs">Image unavailable</span>
      </span>
    );
  }

  return (
    <img
      alt=""
      className="absolute inset-0 size-full object-cover"
      decoding="async"
      loading="lazy"
      onError={() => setFailed(character.image.id)}
      src={mediaUrl(character.image)}
    />
  );
}
