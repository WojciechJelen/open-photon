import { useEffect, useRef } from "react";

/** A muted, looping, inline preview that starts by itself. */
export function LoopingVideo({ label, src }: { label: string; src: string }) {
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
      className="aspect-3/4 w-full rounded-md bg-muted object-cover"
      loop
      muted
      playsInline
      preload="metadata"
      ref={video}
      src={src}
    />
  );
}
