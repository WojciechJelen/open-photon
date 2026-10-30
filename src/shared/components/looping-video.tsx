import { cn } from "cn";
import { useEffect, useRef, useState } from "react";

/**
 * A muted, looping, inline preview that starts by itself; 3:4 and cropped unless `className` says
 * otherwise. Without a `label` it is decoration (inside a labelled tile) and hidden from assistive
 * technology. `onTime` hears where it is, for a timecode readout. `lazy`: it shows its poster and
 * loads nothing until it is near the screen, then plays while it is, and pauses off it (without
 * `IntersectionObserver` it simply plays). `paused` holds it, for a page with its own Pause.
 */
export function LoopingVideo({
  className,
  label,
  lazy = false,
  onTime,
  paused = false,
  poster,
  src,
}: {
  className?: string;
  label?: string;
  lazy?: boolean;
  onTime?: (seconds: number) => void;
  paused?: boolean;
  poster?: string;
  src: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  // Whether it is on (or near) the screen; always for an eager one.
  const [visible, setVisible] = useState(!lazy);
  // Once near the screen, the source stays set: scrolling back resumes instead of loading again.
  const [seen, setSeen] = useState(!lazy);

  useEffect(() => {
    const element = video.current;

    if (!lazy || !element) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      setVisible(true);

      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const intersecting = entry?.isIntersecting ?? false;

        setVisible(intersecting);
        setSeen((before) => before || intersecting);
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [lazy]);

  useEffect(() => {
    const element = video.current;

    if (!element || !seen) {
      return;
    }

    if (!visible || paused) {
      element.pause();

      return;
    }

    // React renders `muted` as a property, not an attribute, so server-rendered markup reaches
    // the browser unmuted and autoplay is refused; set it and start once hydrated.
    element.muted = true;
    element.play().catch(() => {
      // A browser that still refuses autoplay shows the poster or first frame; it is decorative.
    });
  }, [paused, seen, src, visible]);

  return (
    <video
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      autoPlay={!lazy}
      className={cn("aspect-3/4 w-full rounded-md bg-muted object-cover", className)}
      loop
      muted
      onTimeUpdate={onTime && ((event) => onTime(event.currentTarget.currentTime))}
      playsInline
      poster={poster}
      preload={lazy ? "none" : "metadata"}
      ref={video}
      src={seen ? src : undefined}
    />
  );
}
