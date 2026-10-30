import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, ChevronsLeftRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { PickableCharacter } from "#/features/characters";
import type { loadStudio, SampleMotion } from "#/features/motionTransfer/api";
import { AiTag } from "#/features/studio/components/ai-tag";
import { useReducedMotion } from "#/features/studio/reduced-motion";
import { Hud, StatusDot, Viewfinder } from "#/shared/components/brand";
import { LoopingVideo } from "#/shared/components/looping-video";
import { PoweredBy } from "#/shared/components/powered-by";
import { mediaUrl } from "#/shared/media";

/** A done pre-rendered sample take, as the selection reads it (`findSampleTake`). */
export type SampleTake = NonNullable<Awaited<ReturnType<typeof loadStudio>>["sampleTake"]>;

const media = "absolute inset-0 size-full rounded-none bg-screen object-cover";

// The moment of the move the home page stops on, in seconds: facing the camera, the whole body in
// frame. The feature card shows it, and both clips rest on it when they hold still.
export const STILL_AT = 2.4;

// How far the split moves: the handle stays inside the frame.
const SPLIT_MIN = 10;
const SPLIT_MAX = 90;

const splitKeys = new Map([
  ["ArrowDown", -5],
  ["ArrowLeft", -5],
  ["ArrowRight", 5],
  ["ArrowUp", 5],
  ["End", 100],
  ["Home", -100],
]);

// A take's clip and its source differ by a few frames, so their loops drift apart: past this the
// take is brought back. Seeking a playing video stutters, so never for less.
const DRIFT_S = 0.2;

function clampSplit(split: number) {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, split));
}

/** Seconds as a camera's running timecode, `HH:MM:SS:FF`, at the clip's frame rate. */
function runningTimecode(seconds: number, fps: number) {
  const whole = Math.floor(seconds);
  const frame = Math.floor((seconds - whole) * fps);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}:${pad(frame)}`;
}

/**
 * The monitor's split, a slider over the whole frame; the handle sits on `--split` and takes the
 * focus ring, which the frame's corners would cut. Without scripts it simply stays in the middle.
 * A phone shows the line without a handle, so it has none.
 */
function SplitHandle({ onChange, split }: { onChange: (split: number) => void; split: number }) {
  // Where the drag took hold. A mouse jumps the split to itself; a finger only moves it by how far
  // it goes sideways, so one that starts to scroll the page leaves the split alone.
  const hold = useRef({ split, x: 0 });

  function dragTo(clientX: number, over: HTMLElement) {
    const distance = (clientX - hold.current.x) / over.getBoundingClientRect().width;

    onChange(clampSplit(hold.current.split + distance * 100));
  }

  return (
    <div
      aria-label="Move the split between the source and your character"
      aria-valuemax={SPLIT_MAX}
      aria-valuemin={SPLIT_MIN}
      aria-valuenow={Math.round(split)}
      aria-valuetext={`${Math.round(split)}% source`}
      className="group absolute inset-0 cursor-ew-resize touch-pan-y outline-hidden max-sm:hidden"
      onKeyDown={(event) => {
        const step = splitKeys.get(event.key);

        if (step) {
          event.preventDefault();
          onChange(clampSplit(split + step));
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }

        const { left, width } = event.currentTarget.getBoundingClientRect();
        const under = ((event.clientX - left) / width) * 100;

        hold.current = { split: event.pointerType === "touch" ? split : under, x: event.clientX };
        event.currentTarget.setPointerCapture(event.pointerId);
        dragTo(event.clientX, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          dragTo(event.clientX, event.currentTarget);
        }
      }}
      role="slider"
      tabIndex={0}
    >
      <span className="absolute top-1/2 left-(--split,50%) grid size-11 -translate-1/2 place-items-center rounded-full bg-foreground text-primary-foreground group-focus-visible:shadow-picked">
        <ChevronsLeftRightIcon aria-hidden="true" className="size-4.5" />
      </span>
    </div>
  );
}

/**
 * The compare monitor: the source clip beside the pre-rendered take of it (or, before there is
 * one, beside a sample character, what you would pick to make it), split by a line you can drag.
 * A side too narrow for its tag lets it fade, so no scrap of one shows, but a take's AI-generated
 * tag stays on the frame wherever the line is; a sample character says so in its alt text. A REC readout runs with the clip; for a visitor who
 * asked for less motion both hold still on one moment. With no clip at all, it is left out.
 */
function HeroMonitor({
  character,
  motion,
  take,
}: {
  character: PickableCharacter | undefined;
  motion: SampleMotion | undefined;
  take: SampleTake | null;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [split, setSplit] = useState(50);
  const still = useReducedMotion();

  useEffect(() => {
    frame.current?.style.setProperty("--split", `${split}%`);
  }, [split]);

  useEffect(() => {
    if (still) {
      for (const video of frame.current?.querySelectorAll("video") ?? []) {
        video.currentTime = STILL_AT;
      }
    }
  }, [still]);

  const source = take?.source ?? motion?.clip;

  if (!source) {
    return null;
  }

  const fps = Math.round(source.fps ?? 24);
  const motionTitle = take?.motionTitle ?? motion?.title ?? "a sample motion";

  function follow(seconds: number) {
    setTime(seconds);

    const video = result.current?.querySelector("video");

    if (
      video &&
      !video.seeking &&
      seconds < video.duration &&
      Math.abs(video.currentTime - seconds) > DRIFT_S
    ) {
      video.currentTime = seconds;
    }
  }

  return (
    // Beside the headline it stays above a laptop's fold, a little smaller on a short screen.
    <div className="flex min-w-0 flex-col gap-2.5 lg:w-full lg:justify-self-end [@media(44rem<height<=48rem)]:lg:max-w-138 [@media(height<=44rem)]:lg:max-w-108">
      <div aria-hidden="true" className="flex items-center justify-between gap-3 max-sm:hidden">
        <Hud>Cam A</Hud>
        <Hud className="inline-flex items-center gap-2" tone="foreground">
          <StatusDot tone="tally" />
          Rec {runningTimecode(time, fps)}
        </Hud>
      </div>
      <div
        className="relative aspect-square overflow-hidden rounded-menu border bg-screen shadow-monitor-hero sm:rounded-2xl"
        ref={frame}
      >
        <div className="@container absolute inset-y-0 left-0 w-(--split,50%) overflow-hidden">
          <LoopingVideo
            className={media}
            label={`Source motion: ${motionTitle}`}
            onTime={follow}
            paused={still}
            src={mediaUrl(source)}
          />
          {/* Clear of the viewfinder's corner. */}
          <span className="absolute top-2.5 right-2 left-7 transition-opacity sm:top-3.5 sm:right-3 sm:left-9 @max-[7.5rem]:opacity-0">
            <Badge variant="solid">Source</Badge>
          </span>
        </div>
        <div
          className="@container absolute inset-y-0 right-0 left-(--split,50%) overflow-hidden"
          ref={result}
        >
          {take ? (
            <LoopingVideo
              className={media}
              label={`${take.characterTitle ?? "A sample character"} performing ${motionTitle}, an AI-generated video`}
              paused={still}
              poster={take.poster ? mediaUrl(take.poster) : undefined}
              src={mediaUrl(take.result)}
            />
          ) : (
            character && (
              <img
                alt={`Sample character: ${character.title ?? "a sample"}, an AI-generated image`}
                className={media}
                src={mediaUrl(character.image)}
              />
            )
          )}
          <span className="absolute inset-x-3 top-3.5 transition-opacity max-sm:hidden @max-[11rem]:opacity-0">
            <Badge variant="solid">Your character</Badge>
          </span>
        </div>
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-(--split,50%) w-0.5 -translate-x-1/2 bg-foreground"
        />
        {take && <AiTag className="right-7 bottom-2.5 sm:right-9 sm:bottom-3.5" />}
        <Viewfinder className="max-sm:inset-2.5 max-sm:*:size-3.5" />
        <SplitHandle onChange={setSplit} split={split} />
      </div>
    </div>
  );
}

/**
 * The studio's opening: the pitch, the ways in and, beside them, the compare monitor. On a phone
 * they stack, the monitor between the buttons and the partners.
 */
export function StudioHero({
  characters,
  motions,
  take,
}: {
  characters: PickableCharacter[];
  motions: SampleMotion[];
  take: SampleTake | null;
}) {
  return (
    <section className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-center lg:gap-8 xl:gap-14">
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-7">
        <div className="flex flex-col gap-5">
          <h1 className="type-hero wrap-anywhere">
            Make the shot.
            <br />
            <span className="bg-render bg-clip-text text-transparent">Own the recipe.</span>
          </h1>
          <p className="max-w-125 text-base/normal text-pretty wrap-anywhere text-soft-foreground sm:text-lg/normal">
            Give any character any move. Turn one photo into a full shoot, a storyboard or a
            game-ready sprite.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-2.5">
          <Button asChild>
            <Link to="/motionTransfer">
              <span>Start with Motion Transfer</span>
              <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/explore">
              <span>Browse takes</span>
            </Link>
          </Button>
        </div>
        <PoweredBy className="order-last lg:order-0 lg:pt-2" />
      </div>
      <HeroMonitor character={characters[0]} motion={motions[0]} take={take} />
    </section>
  );
}
