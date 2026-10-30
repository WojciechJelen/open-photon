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
import { Viewfinder } from "#/shared/components/brand";
import { timecode } from "#/shared/timecode";

// The source is moved back onto the result's time only past this drift: seeking a playing video
// stutters, and a frame or two (24 fps) between the panels is not visible.
const DRIFT_S = 0.1;

type Playback = "paused" | "playing" | "ended";

/** How the two clips show: next to each other, or one over the other with a swipe line. */
export type CompareView = "side" | "swipe";

/**
 * The classes of each way the frames lay out. `auto` is side by side until 640 px and, under it,
 * looks like the swipe view: the server cannot know the screen's width, so a phone's first paint
 * already is what it hydrates into (`useWide`, `ResultView`). Where a viewfinder is drawn (side by
 * side from 640 px) the captions sit inside its corners, not on them.
 */
const layouts = {
  auto: {
    box: "max-sm:overflow-hidden max-sm:rounded-xl sm:grid-cols-2",
    caption: "inset-x-3 top-3 sm:inset-x-6 sm:top-6",
    landscape: "max-sm:max-w-3xl",
    portrait: "max-sm:max-w-stage sm:max-w-stage-pair",
    resultCaption: "max-sm:items-end",
    resultFrame: "max-sm:col-start-1 max-sm:clip-split sm:col-start-2 sm:rounded-xl",
    sourceFrame: "sm:rounded-xl",
  },
  side: {
    box: "grid-cols-2",
    caption: "inset-x-3 top-3 sm:inset-x-6 sm:top-6",
    landscape: "",
    portrait: "max-w-stage-pair",
    resultCaption: "",
    resultFrame: "col-start-2 rounded-xl",
    sourceFrame: "rounded-xl",
  },
  swipe: {
    box: "overflow-hidden rounded-xl",
    caption: "inset-x-3 top-3",
    landscape: "max-w-3xl",
    portrait: "max-w-stage",
    resultCaption: "items-end",
    resultFrame: "col-start-1 clip-split",
    sourceFrame: "",
  },
};

/**
 * The source clip and the result on one clock. The result is the master: its play, pause, seeks,
 * stalls and rate drive the source, which is muted (the result carries the clip's audio, so it
 * plays once). One transport controls both: play/pause, a scrubber, sound and full screen; a
 * portrait pair is sized so the frames and the transport fit the viewport together: the player
 * measures what lies above its frames and what below them (`--stage-chrome`, `src/styles.css`).
 * The frames' place on the page is the swipe view's box in either view, so the transport stays put
 * when side by side is the shorter one (on a phone, or with a landscape clip).
 * `view` is side by side, or swipe: the result lies over the source and a swipe slider uncovers
 * it from the right (`clip-split`, `src/styles.css`). Switching keeps both videos playing: the
 * same two elements only move. `auto`: `view` came from the screen's width, not from a choice.
 * The take says it is AI-generated in its caption, in either view.
 */
export function ComparePlayer({
  auto,
  portrait,
  poster,
  result,
  source,
  view,
}: {
  auto: boolean;
  portrait: boolean;
  poster: string | undefined;
  result: string;
  source: string;
  view: CompareView;
}) {
  const player = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    /**
     * Sets `--stage-chrome` to the page above the frames (header, navigation, heading, however
     * they wrap) plus the gap and the transport below them and a 1rem margin, so the frames take
     * the rest of the viewport's height. Full screen shows the frames alone: nothing to measure.
     */
    function measure() {
      const outer = player.current;

      if (!outer || !stage.current || document.fullscreenElement) {
        return;
      }

      const frames = stage.current.getBoundingClientRect();
      const below = outer.getBoundingClientRect().height - frames.height;

      outer.style.setProperty(
        "--stage-chrome",
        `calc(${frames.top + window.scrollY + below}px + 1rem)`,
      );
    }

    measure();

    // What lies above the frames changes the page's height when it wraps or grows (web fonts, a
    // status line); the viewport's size changes how it wraps.
    const observer = new ResizeObserver(measure);

    observer.observe(document.body);
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, []);

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

  // Full screen, a frame fits the screen's height whole, and is never cropped to the page's shape.
  const videoClass = cn(
    "block w-full object-cover [:fullscreen_&]:h-dvh [:fullscreen_&]:object-contain",
    portrait ? "aspect-9/16" : "aspect-video",
  );

  const swipe = view === "swipe";
  const layout = layouts[auto && !swipe ? "auto" : view];

  return (
    <div className="flex flex-col gap-5" ref={player}>
      {/* Never wider than two 312 px frames, or one in the swipe view: the view moves nothing. */}
      <div
        className={cn(
          "mx-auto grid w-full grid-cols-1 items-center",
          portrait && (swipe ? "max-w-78" : "max-w-159"),
        )}
        ref={stage}
      >
        <span
          aria-hidden="true"
          className={cn(
            "invisible col-start-1 row-start-1 mx-auto w-full",
            portrait ? "max-w-78" : "max-w-3xl",
          )}
        >
          <span
            className={cn("mx-auto block", portrait ? "aspect-9/16 max-w-stage" : "aspect-video")}
          />
        </span>
        <div
          className={cn(
            "relative col-start-1 row-start-1 mx-auto grid w-full gap-3",
            layout.box,
            // A portrait frame is as tall as the viewport allows with the transport under it
            // (`src/styles.css`), so its width follows from 9:16; a landscape one is never too tall.
            portrait ? layout.portrait : layout.landscape,
          )}
          ref={box}
        >
          <figure
            className={cn(
              "relative col-start-1 row-start-1 overflow-hidden bg-screen",
              layout.sourceFrame,
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
            <figcaption className={cn("absolute flex", layout.caption)}>
              <Badge variant="solid">Source</Badge>
            </figcaption>
          </figure>
          <figure
            className={cn("relative row-start-1 overflow-hidden bg-screen", layout.resultFrame)}
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
            {!swipe && <Viewfinder className="max-sm:hidden [:fullscreen_&]:hidden" />}
            <figcaption
              className={cn(
                "absolute flex flex-col items-start gap-1.5",
                layout.caption,
                layout.resultCaption,
              )}
            >
              <Badge variant="solid">Take</Badge>
              <span className="rounded-tag bg-background/66 px-1.75 py-0.75 type-tag text-foreground">
                AI-generated
              </span>
            </figcaption>
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
      </div>
      <div className="flex h-16 items-center gap-2.5 rounded-full border bg-card/72 pr-2 pl-2.5 sm:gap-3.5 sm:pr-4">
        <Button
          aria-label={{ ended: "Replay", paused: "Play", playing: "Pause" }[playback]}
          onClick={toggle}
          size="icon"
        >
          {playback === "playing" ? (
            <PauseIcon strokeWidth={2.25} />
          ) : playback === "ended" ? (
            <RotateCcwIcon strokeWidth={2.25} />
          ) : (
            <PlayIcon strokeWidth={2.25} />
          )}
        </Button>
        <span
          aria-hidden="true"
          className="hidden min-w-0 truncate font-mono type-caption tabular-nums sm:inline"
        >
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
          className="hidden min-w-0 truncate font-mono type-caption text-muted-foreground tabular-nums sm:inline"
        >
          {timecode(duration)}
        </span>
        <span
          aria-hidden="true"
          className="min-w-0 truncate font-mono text-xs whitespace-pre text-soft-foreground tabular-nums sm:hidden"
        >
          {time.toFixed(1).padStart(duration.toFixed(1).length)} / {duration.toFixed(1)} s
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
          {muted ? (
            <VolumeXIcon className="size-4.5" strokeWidth={1.75} />
          ) : (
            <Volume2Icon className="size-4.5" strokeWidth={1.75} />
          )}
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
            <MaximizeIcon className="size-4.5" strokeWidth={1.75} />
          </Button>
        </span>
      </div>
    </div>
  );
}
