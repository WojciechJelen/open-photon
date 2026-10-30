import { GeneratedFigure } from "#/shared/components/generated-image";
import type { Asset } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";

/** How a generated video is described to who cannot see it, here and in its share card. */
export const GENERATED_VIDEO_LABEL = "AI-generated video, made with Open Photon";

/**
 * A video output of a generation, whatever workflow made it, disclosed as AI-generated like
 * `GeneratedImage`: a label over it, an accessible name that says so, and, with `download`, a
 * Download of the MP4 (`?download=1`, named by `serveMedia`). It plays on request, with controls,
 * from `poster` (its still, when its workflow cuts one); only its metadata loads before. `place`
 * tells one video of a generation that shows several from the others (`video 2 of 3`): in its
 * name and its Download's.
 */
export function GeneratedVideo({
  asset,
  download = false,
  place,
  poster,
}: {
  asset: Asset;
  download?: boolean;
  place?: string;
  poster: Asset | null;
}) {
  return (
    <GeneratedFigure
      asset={asset}
      badge="AI-generated video"
      download={download}
      downloadLabel={place ? `Download ${place}` : "Download video"}
    >
      <video
        aria-label={place ? `${GENERATED_VIDEO_LABEL} (${place})` : GENERATED_VIDEO_LABEL}
        className="w-full rounded-xl bg-screen"
        controls
        height={asset.height ?? undefined}
        playsInline
        poster={poster ? mediaUrl(poster) : undefined}
        preload="metadata"
        src={mediaUrl(asset)}
        width={asset.width ?? undefined}
      />
    </GeneratedFigure>
  );
}
