import { useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Slider } from "#/components/ui/slider";

// The source is moved back onto the result's time only past this drift: seeking a playing video
// stutters, and a frame or two (24 fps) between the panels is not visible.
const DRIFT_S = 0.1;

type Playback = "paused" | "playing" | "ended";

/**
 * The source clip and the result on one clock. The result is the master: its play, pause, seeks,
 * stalls and rate drive the source, which is muted (the result carries the clip's audio, so it
 * plays once). One play/pause button and one scrubber control the result. Side by side from
 * 640 px; narrower, the result lies over the source and a swipe slider uncovers it from the
 * right (`clip-split`, `src/styles.css`).
 */
export function ComparePlayer({
  portrait,
  poster,
  result,
  source,
}: {
  portrait: boolean;
  poster: string | undefined;
  result: string;
  source: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const resultVideo = useRef<HTMLVideoElement>(null);
  const sourceVideo = useRef<HTMLVideoElement>(null);
  const buffering = useRef(false);
  const [playback, setPlayback] = useState<Playback>("paused");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [split, setSplit] = useState(50);

  useEffect(() => {
    // React renders `muted` as a property, so server-rendered markup reaches the browser unmuted.
    if (sourceVideo.current) {
      sourceVideo.current.muted = true;
    }

    // The server-rendered video may have loaded its metadata before React listened for it.
    const master = resultVideo.current;

    if (master && master.readyState >= HTMLMediaElement.HAVE_METADATA) {
      setDuration(master.duration);
    }
  }, []);

  useEffect(() => {
    box.current?.style.setProperty("--split", `${split}%`);
  }, [split]);

  /**
   * Puts the source at the result's time (past the source's end: its last frame) and lets it play
   * only while the result advances. `force` seeks even within `DRIFT_S`, for a seek of the result.
   */
  function follow(force: boolean) {
    const master = resultVideo.current;
    const follower = sourceVideo.current;

    if (!master || !follower) {
      return;
    }

    const end = Number.isFinite(follower.duration) ? follower.duration : Number.POSITIVE_INFINITY;
    const target = Math.min(master.currentTime, end);

    if (force || Math.abs(follower.currentTime - target) > DRIFT_S) {
      follower.currentTime = target;
    }

    const advancing = !master.paused && !master.ended && !buffering.current && target < end;

    if (advancing && follower.paused) {
      follower.play().catch(() => {
        // Interrupted by a pause or seek of the result; the next event brings it back in step.
      });
    } else if (!advancing && !follower.paused) {
      follower.pause();
    }
  }

  function toggle() {
    const master = resultVideo.current;

    if (!master) {
      return;
    }

    if (master.paused) {
      // After the end, `play()` starts over from 0, and the seek brings the source along.
      master.play().catch(() => {
        // Refused by the browser: the button keeps saying Play.
      });
    } else {
      master.pause();
    }
  }

  function swipeTo(clientX: number) {
    const rect = box.current?.getBoundingClientRect();

    if (rect?.width) {
      setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
    }
  }

  const videoClass = portrait
    ? "aspect-9/16 max-h-screen w-full rounded-md bg-muted object-contain"
    : "aspect-video max-h-screen w-full rounded-md bg-muted object-contain";

  return (
    <div className="flex flex-col gap-3">
      <div className="relative grid gap-4 sm:grid-cols-2" ref={box}>
        <figure className="col-start-1 row-start-1 flex flex-col gap-1">
          <video
            aria-label="Source motion"
            className={videoClass}
            muted
            onLoadedMetadata={() => follow(true)}
            playsInline
            preload="auto"
            ref={sourceVideo}
            src={source}
          />
          <figcaption className="hidden text-sm text-muted-foreground sm:block">Source</figcaption>
        </figure>
        <figure className="col-start-1 row-start-1 flex flex-col gap-1 clip-split sm:col-start-2 sm:clip-none">
          <video
            aria-label="Result"
            className={videoClass}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onEnded={() => {
              setPlayback("ended");
              follow(false);
            }}
            onPause={(event) => {
              setPlayback(event.currentTarget.ended ? "ended" : "paused");
              follow(false);
            }}
            onPlay={() => {
              setPlayback("playing");
              follow(false);
            }}
            onPlaying={() => {
              buffering.current = false;
              follow(true);
            }}
            onRateChange={(event) => {
              if (sourceVideo.current) {
                sourceVideo.current.playbackRate = event.currentTarget.playbackRate;
              }
            }}
            onSeeked={() => follow(true)}
            onSeeking={(event) => {
              const { currentTime, ended } = event.currentTarget;

              setTime(currentTime);
              // A seek back from the end offers Play again, not Replay.
              setPlayback((previous) => (previous === "ended" && !ended ? "paused" : previous));
              follow(true);
            }}
            onTimeUpdate={(event) => {
              setTime(event.currentTarget.currentTime);
              follow(false);
            }}
            onWaiting={() => {
              buffering.current = true;
              follow(false);
            }}
            playsInline
            poster={poster}
            preload="auto"
            ref={resultVideo}
            src={result}
          />
          <figcaption className="hidden text-sm text-muted-foreground sm:block">Result</figcaption>
        </figure>
        <div
          aria-label="Swipe between source and result"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(split)}
          className="absolute inset-0 cursor-ew-resize touch-pan-y sm:hidden"
          onKeyDown={(event) => {
            const step = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;

            if (step) {
              event.preventDefault();
              setSplit((previous) => Math.min(100, Math.max(0, previous + step)));
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            swipeTo(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              swipeTo(event.clientX);
            }
          }}
          role="slider"
          tabIndex={0}
        >
          <div className="absolute inset-y-0 left-(--split) w-0.5 -translate-x-1/2 bg-background" />
          <span className="absolute top-2 left-2 rounded-sm bg-background/80 px-2 text-xs">
            Source
          </span>
          <span className="absolute top-2 right-2 rounded-sm bg-background/80 px-2 text-xs">
            Result
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={toggle} variant="outline">
          {{ ended: "Replay", paused: "Play", playing: "Pause" }[playback]}
        </Button>
        <Slider
          disabled={!duration}
          max={duration || 1}
          min={0}
          onValueChange={([value]) => {
            if (resultVideo.current && value !== undefined) {
              resultVideo.current.currentTime = value;
            }
          }}
          step={0.01}
          thumbLabels={["Seek"]}
          value={[Math.min(time, duration || 1)]}
        />
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {time.toFixed(1)} / {duration.toFixed(1)} s
        </span>
      </div>
    </div>
  );
}
