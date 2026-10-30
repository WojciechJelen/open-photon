import { cn } from "cn";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useRef, useState } from "react";

import type { Preset } from "#/features/presets/catalog";
import { previewUrl } from "#/features/presets/previews";
import { Hud, Viewfinder } from "#/shared/components/brand";

/**
 * A preset's example take: a real output of its motion, look and seed with a sample character. It
 * never plays by itself; the visitor starts it with "Play example", and it loops until paused. The
 * video's own controls (seek, mute, full screen) join it from then on, and until then the box, set
 * to 9:16 before the video loads, shows the poster in its viewfinder. The play button fills the
 * box until it has started, then only its round mark takes clicks, so the controls stay reachable.
 */
export function PresetPlayer({ preset }: { preset: Preset }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const { character, poster, video: file } = preset.example;

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2.5">
      <div className="group/player relative aspect-9/16 overflow-hidden rounded-2xl border bg-screen shadow-monitor-preset">
        <video
          aria-label={`AI-generated example take of ${preset.title}: ${character.title}, a sample character`}
          className="absolute inset-0 size-full object-cover"
          controls={started}
          height={848}
          loop
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          playsInline
          poster={previewUrl(poster)}
          preload="metadata"
          ref={video}
          src={previewUrl(file)}
          width={480}
        />
        {!started && <Viewfinder />}
        <button
          aria-label={playing ? "Pause example" : "Play example"}
          className={cn(
            "group/play absolute inset-0 grid cursor-pointer place-items-center outline-none",
            started && "pointer-events-none",
          )}
          onClick={() => {
            const element = video.current;

            if (!element) {
              return;
            }

            setStarted(true);

            if (element.paused) {
              void element.play().catch(() => {
                // A browser that refuses to play keeps the poster; the native controls remain.
              });
            } else {
              element.pause();
            }
          }}
          type="button"
        >
          <span
            className={cn(
              "pointer-events-auto grid size-16 place-items-center rounded-full bg-background/66 text-foreground transition-opacity group-focus-visible/play:outline-2 group-focus-visible/play:outline-offset-3 group-focus-visible/play:outline-ring",
              playing &&
                "opacity-0 group-hover/player:opacity-100 group-focus-visible/play:opacity-100",
            )}
          >
            {playing ? (
              <PauseIcon aria-hidden="true" className="size-5.5" />
            ) : (
              <PlayIcon aria-hidden="true" className="size-5.5" />
            )}
          </span>
        </button>
      </div>
      <figcaption className="flex min-w-0 items-baseline justify-between gap-3">
        <span
          className="min-w-0 truncate type-caption text-muted-foreground"
          title={`Example with ${character.title}`}
        >
          Example with {character.title}
        </span>
        <Hud className="max-w-1/2 shrink-0 truncate">AI-generated</Hud>
      </figcaption>
    </figure>
  );
}
