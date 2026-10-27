import { DownloadIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { Asset } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";

/** How a generated image is described to who cannot see it, here and in its share card. */
export const GENERATED_IMAGE_ALT = "AI-generated image, made with Open Photon";

/**
 * A generated file (`children`, the image or the video of `asset`) disclosed as AI-generated
 * wherever it is shown: `badge` over it, a caption that says so and, with `download`, a Download
 * of `asset` (`?download=1`: `serveMedia` names the file), called `downloadLabel` for assistive
 * technology when given.
 */
export function GeneratedFigure({
  asset,
  badge,
  children,
  download,
  downloadLabel,
}: {
  asset: Asset;
  badge: string;
  children: ReactNode;
  download: boolean;
  downloadLabel?: string;
}) {
  return (
    <figure className="flex flex-col gap-3">
      <div className="relative">
        {children}
        <span className="absolute top-3.5 left-3.5">
          <Badge variant="solid">{badge}</Badge>
        </span>
      </div>
      <figcaption className="text-sm text-soft-foreground">
        AI-generated with open-weights models on Open Photon.
      </figcaption>
      {download && (
        <Button asChild size="lg" variant="outline">
          <a aria-label={downloadLabel} download href={`${mediaUrl(asset)}?download=1`}>
            <DownloadIcon />
            Download
          </a>
        </Button>
      )}
    </figure>
  );
}

/**
 * An image output of a generation, whatever workflow made it, disclosed as AI-generated wherever
 * it is shown (the FLUX Kommunity licence asks for it; everything this app generates is): a label
 * over it, alt text that says so, and, with `download`, a Download whose file is named
 * `ai-generated-<id>.<ext>` (`serveMedia`). It shows nothing of the recipe: a caption enhanced for
 * it stays private. `place` tells one image of a generation that shows several from the others
 * (`image 2 of 3`, `GeneratedOutputs`): in its alt text and its Download's name.
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
    <GeneratedFigure
      asset={asset}
      badge="AI-generated image"
      download={download}
      downloadLabel={place ? `Download ${place}` : undefined}
    >
      <img
        alt={place ? `${GENERATED_IMAGE_ALT} (${place})` : GENERATED_IMAGE_ALT}
        className="w-full rounded-3xl border bg-screen"
        height={asset.height ?? undefined}
        src={mediaUrl(asset)}
        width={asset.width ?? undefined}
      />
    </GeneratedFigure>
  );
}
