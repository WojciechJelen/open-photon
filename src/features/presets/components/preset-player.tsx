import { PauseIcon, PlayIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import type { Preset } from "#/features/presets/catalog";
import { previewUrl } from "#/features/presets/previews";

/**
 * A preset's example take: a real output of its motion, look and seed with a sample character.
 * It never plays by itself; the visitor starts it with "Play example" (or the video's own
 * controls, which also seek, mute and go full screen), and it loops until paused.
 */
export function PresetPlayer({ preset }: { preset: Preset }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const { character, poster, video: file } = preset.example;

  return (
    <figure className="flex flex-col gap-3">
      <video
        aria-label={`Example take of ${preset.title}: ${character.title}, a sample character`}
        className="aspect-480/848 w-full rounded-2xl border bg-muted object-cover"
        controls
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
      <figcaption className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-soft-foreground">
          {character.title} (sample character) performing this preset: a real Motion Transfer
          render.
        </span>
        <Button
          onClick={() => {
            const element = video.current;

            if (!element) {
              return;
            }

            if (element.paused) {
              void element.play().catch(() => {
                // A browser that refuses to play keeps the poster; the native controls remain.
              });
            } else {
              element.pause();
            }
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {playing ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
          {playing ? "Pause example" : "Play example"}
        </Button>
      </figcaption>
    </figure>
  );
}
