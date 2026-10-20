import { cn } from "cn";
import { useEffect, useRef } from "react";

/**
 * A muted, looping, inline preview that starts by itself; 3:4 and cropped unless `className` says
 * otherwise. Without a `label` it is decoration (inside a labelled tile) and hidden from assistive
 * technology. `onTime` hears where it is, for a timecode readout.
 */
export function LoopingVideo({
  className,
  label,
  onTime,
  poster,
  src,
}: {
  className?: string;
  label?: string;
  onTime?: (seconds: number) => void;
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
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      autoPlay
      className={cn("aspect-3/4 w-full rounded-md bg-muted object-cover", className)}
      loop
      muted
      onTimeUpdate={onTime && ((event) => onTime(event.currentTarget.currentTime))}
      playsInline
      poster={poster}
      preload="metadata"
      ref={video}
      src={src}
    />
  );
}
