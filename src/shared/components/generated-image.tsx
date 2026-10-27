import { DownloadIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { Asset } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";

/** How a generated image is described to who cannot see it, here and in its share card. */
export const GENERATED_IMAGE_ALT = "AI-generated image, made with Open Photon";

/**
 * An image output of a generation, whatever workflow made it, disclosed as AI-generated wherever
 * it is shown (the FLUX Kommunity licence asks for it; everything this app generates is): a label
 * over it, alt text that says so, and, with `download`, a Download whose file is named
 * `ai-generated-<id>.<ext>` (`serveMedia`). It shows nothing of the recipe: a caption enhanced for
 * it stays private. `place` tells one image of a generation that shows several from the others
 * (`imagePlace`): in its alt text and its Download's name.
 */
export function GeneratedImage({
  asset,
  download = false,
  place,
}: {
  asset: Asset;
  download?: boolean;
  place?: string;
}) {
  return (
    <figure className="flex flex-col gap-3">
      <div className="relative">
        <img
          alt={place ? `${GENERATED_IMAGE_ALT} (${place})` : GENERATED_IMAGE_ALT}
          className="w-full rounded-3xl border bg-screen"
          height={asset.height ?? undefined}
          src={mediaUrl(asset)}
          width={asset.width ?? undefined}
        />
        <span className="absolute top-3.5 left-3.5">
          <Badge variant="solid">AI-generated image</Badge>
        </span>
      </div>
      <figcaption className="text-sm text-soft-foreground">
        AI-generated with open-weights models on Open Photon.
      </figcaption>
      {download && (
        <Button asChild size="lg" variant="outline">
          <a
            aria-label={place ? `Download ${place}` : undefined}
            download
            href={`${mediaUrl(asset)}?download=1`}
          >
            <DownloadIcon />
            Download
          </a>
        </Button>
      )}
    </figure>
  );
}

/**
 * Which of a generation's `count` image outputs the one at `index` is (`image 2 of 3`), for
 * `GeneratedImage`'s `place`; `undefined` when it is the only one.
 */
export function imagePlace(index: number, count: number) {
  return count > 1 ? `image ${index + 1} of ${count}` : undefined;
}
