import { cn } from "cn";
import {
  ChevronsLeftRightIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Slider } from "#/components/ui/slider";
import { StatusDot, Viewfinder } from "#/shared/components/brand";
import { timecode } from "#/shared/timecode";

// The source is moved back onto the result's time only past this drift: seeking a playing video
// stutters, and a frame or two (24 fps) between the panels is not visible.
const DRIFT_S = 0.1;

type Playback = "paused" | "playing" | "ended";

/** How the two clips show: next to each other, or one over the other with a swipe line. */
export type CompareView = "side" | "swipe";

/**
 * The source clip and the result on one clock. The result is the master: its play, pause, seeks,
 * stalls and rate drive the source, which is muted (the result carries the clip's audio, so it
 * plays once). One transport controls both: play/pause, a scrubber, sound and full screen; a
 * portrait pair is sized so the frames and the transport fit the viewport together.
 * `view` is side by side, or swipe: the result lies over the source and a swipe slider uncovers
 * it from the right (`clip-split`, `src/styles.css`). Switching keeps both videos playing: the
 * same two elements only move.
 */
export function ComparePlayer({
  portrait,
  poster,
  result,
  source,
  view,
}: {
  portrait: boolean;
  poster: string | undefined;
  result: string;
  source: string;
  view: CompareView;
}) {
  const box = useRef<HTMLDivElement>(null);
  const resultVideo = useRef<HTMLVideoElement>(null);
  const sourceVideo = useRef<HTMLVideoElement>(null);
  const buffering = useRef(false);
  const [playback, setPlayback] = useState<Playback>("paused");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [split, setSplit] = useState(50);
  const [muted, setMuted] = useState(false);

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

  /** Moves the swipe line to the pointer, measured across the picture it lies over. */
  function swipeTo(clientX: number, over: HTMLElement) {
    const rect = over.getBoundingClientRect();

    if (rect.width) {
      setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
    }
  }

  const videoClass = cn("block w-full object-cover", portrait ? "aspect-9/16" : "aspect-video");

  const swipe = view === "swipe";

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "relative grid gap-3",
          "mx-auto w-full",
          swipe ? "overflow-hidden rounded-2xl border" : "grid-cols-2",
          // A portrait frame is as tall as the viewport allows with the transport under it
          // (`src/styles.css`), so its width follows from 9:16; a landscape one is never too tall.
          swipe && (portrait ? "max-w-stage" : "max-w-3xl"),
          !swipe && portrait && "max-w-stage-pair",
        )}
        ref={box}
      >
        <figure
          className={cn(
            "relative col-start-1 row-start-1 overflow-hidden bg-screen",
            !swipe && "rounded-2xl border",
          )}
        >
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
          <figcaption className="absolute top-3.5 left-3.5">
            <Badge variant="solid">Source</Badge>
          </figcaption>
        </figure>
        <figure
          className={cn(
            "relative row-start-1 overflow-hidden bg-screen",
            swipe ? "col-start-1 clip-split" : "col-start-2 rounded-2xl border border-brand/40",
          )}
        >
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
            onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
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
          <figcaption className={cn("absolute top-3.5", swipe ? "right-3.5" : "left-3.5")}>
            <Badge variant="solid">
              <StatusDot tone="brand" />
              Result
            </Badge>
          </figcaption>
          {!swipe && <Viewfinder tone="brand" />}
        </figure>
        {swipe && (
          <div
            aria-label="Swipe between source and result"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(split)}
            aria-valuetext={`${Math.round(split)}% source`}
            className="absolute inset-0 cursor-ew-resize touch-pan-y focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            onKeyDown={(event) => {
              const step =
                event.key === "ArrowLeft" || event.key === "ArrowDown"
                  ? -5
                  : event.key === "ArrowRight" || event.key === "ArrowUp"
                    ? 5
                    : 0;

              if (step) {
                event.preventDefault();
                setSplit((previous) => Math.min(100, Math.max(0, previous + step)));
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                setSplit(event.key === "Home" ? 0 : 100);
              }
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              swipeTo(event.clientX, event.currentTarget);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                swipeTo(event.clientX, event.currentTarget);
              }
            }}
            role="slider"
            tabIndex={0}
          >
            <span className="absolute inset-y-0 left-(--split) w-0.5 -translate-x-1/2 bg-foreground" />
            <span className="absolute top-1/2 left-(--split) grid size-12 -translate-1/2 place-items-center rounded-full bg-foreground text-primary-foreground shadow-modal">
              <ChevronsLeftRightIcon aria-hidden="true" className="size-5" />
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2.5 rounded-full border bg-linear-to-b from-foreground/4 to-foreground/1 py-2 pr-2 pl-2.5 sm:gap-3.5 sm:pr-3">
        <Button
          aria-label={{ ended: "Replay", paused: "Play", playing: "Pause" }[playback]}
          onClick={toggle}
          size="icon"
        >
          {playback === "playing" ? (
            <PauseIcon className="fill-current" />
          ) : playback === "ended" ? (
            <RotateCcwIcon />
          ) : (
            <PlayIcon className="fill-current" />
          )}
        </Button>
        <span aria-hidden="true" className="hidden shrink-0 font-mono text-sm sm:inline">
          {timecode(time)}
        </span>
        <div className="min-w-0 flex-1">
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
        </div>
        <span
          aria-hidden="true"
          className="hidden shrink-0 font-mono text-sm text-muted-foreground sm:inline"
        >
          {timecode(duration)}
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 font-mono text-xs text-soft-foreground tabular-nums sm:hidden"
        >
          {time.toFixed(1)} / {duration.toFixed(1)} s
        </span>
        <Button
          aria-label={
            muted
              ? "Unmute: the sound is the clip's original audio"
              : "Mute: the sound is the clip's original audio"
          }
          onClick={() => {
            if (resultVideo.current) {
              resultVideo.current.muted = !resultVideo.current.muted;
            }
          }}
          size="icon"
          variant="ghost"
        >
          {muted ? <VolumeXIcon /> : <Volume2Icon />}
        </Button>
        <span className="hidden sm:inline-flex">
          <Button
            aria-label="Full screen"
            onClick={() => {
              box.current?.requestFullscreen().catch(() => {
                // Refused (an iframe, an old browser): the player stays as it is.
              });
            }}
            size="icon"
            variant="ghost"
          >
            <MaximizeIcon />
          </Button>
        </span>
      </div>
    </div>
  );
}
