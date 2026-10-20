import { cn } from "cn";
import { useEffect, useRef } from "react";

/** A muted, looping, inline preview that starts by itself; 3:4 and cropped unless `className` says otherwise. */
export function LoopingVideo({
  className,
  label,
  poster,
  src,
}: {
  className?: string;
  label: string;
  poster?: string;
  src: string;
}) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;

    if (!element) {
      return;
    }

    // React renders `muted` as a property, not an attribute, so server-rendered markup reaches
    // the browser unmuted and autoplay is refused; set it and start once hydrated.
    element.muted = true;
    element.play().catch(() => {
      // A browser that still refuses autoplay shows the first frame; the preview is decorative.
    });
  }, [src]);

  return (
    <video
      aria-label={label}
      autoPlay
      className={cn("aspect-3/4 w-full rounded-md bg-muted object-cover", className)}
      loop
      muted
      playsInline
      poster={poster}
      preload="metadata"
      ref={video}
      src={src}
    />
  );
}
