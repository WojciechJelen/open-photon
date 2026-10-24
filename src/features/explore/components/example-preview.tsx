import { cn } from "cn";
import { VideoOffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LoopingVideo } from "#/shared/components/looping-video";
import type { Asset } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";

/**
 * A take's result looping while it is on screen (`LoopingVideo` `lazy`), cover-cropped in its
 * frame. When the file cannot be loaded (removed, unreadable), its poster takes its place, or,
 * without one, a "Preview unavailable" panel: the page around it stays usable. `label` names the
 * video to assistive technology; without one it is decoration inside a labelled link.
 */
export function ExamplePreview({
  className,
  label,
  poster,
  video,
}: {
  className?: string;
  label?: string;
  poster: Asset | null;
  video: Asset;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<"poster" | "video" | null>(null);

  // A media element's `error` does not bubble; a capturing listener on the frame still hears it.
  useEffect(() => {
    const element = frame.current;

    if (!element) {
      return;
    }

    const fail = (event: Event) =>
      setFailed(event.target instanceof HTMLImageElement ? "poster" : "video");

    element.addEventListener("error", fail, true);

    return () => element.removeEventListener("error", fail, true);
  }, []);

  return (
    <div className={cn("relative overflow-hidden bg-screen", className)} ref={frame}>
      {failed === null ? (
        <LoopingVideo
          className="absolute inset-0 size-full rounded-none object-cover"
          label={label}
          lazy
          poster={poster ? mediaUrl(poster) : undefined}
          src={mediaUrl(video)}
        />
      ) : failed === "video" && poster ? (
        <img
          alt={label ? `${label} (still)` : ""}
          className="absolute inset-0 size-full object-cover"
          src={mediaUrl(poster)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">
          <span className="flex flex-col items-center gap-2">
            <VideoOffIcon aria-hidden="true" className="size-6" />
            Preview unavailable
          </span>
        </div>
      )}
    </div>
  );
}
