import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowRightIcon, ChevronsLeftRightIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { PickableCharacter } from "#/features/characters";
import type { loadStudio, SampleMotion } from "#/features/motionTransfer/api";
import { ResultWall, type WallTake } from "#/features/studio/components/result-wall";
import { Hud, REPOSITORY_URL, StatusDot, Viewfinder } from "#/shared/components/brand";
import { LoopingVideo } from "#/shared/components/looping-video";
import { mediaUrl } from "#/shared/media";

/** A done pre-rendered sample take, as the selection reads it (`findSampleTake`). */
export type SampleTake = NonNullable<Awaited<ReturnType<typeof loadStudio>>["sampleTake"]>;

/** Seconds as a camera's running timecode, `HH:MM:SS:FF`, at the clip's frame rate. */
function runningTimecode(seconds: number, fps: number) {
  const whole = Math.floor(seconds);
  const frame = Math.floor((seconds - whole) * fps);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}:${pad(frame)}`;
}

/**
 * The split monitor, before any sample take is pre-rendered: the source motion on the left and a
 * sample character on the right (what you would pick to make the take). A REC readout runs with
 * the clip. With no sample motion at all, it is left out.
 */
function HeroMonitor({
  character,
  motion,
}: {
  character: PickableCharacter | undefined;
  motion: SampleMotion | undefined;
}) {
  const [time, setTime] = useState(0);

  if (!motion) {
    return null;
  }

  const source = motion.clip;
  const fps = Math.round(source.fps ?? 24);

  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-3">
        <Hud>
          Cam A · {source.width}×{source.height} · {fps} fps
        </Hud>
        <Hud className="inline-flex items-center gap-2" tone="foreground">
          <StatusDot tone="tally" />
          Rec {runningTimecode(time, fps)}
        </Hud>
      </div>
      <div className="relative grid aspect-16/11 grid-cols-2 overflow-hidden rounded-2xl border bg-screen shadow-monitor">
        <div className="relative overflow-hidden">
          <LoopingVideo
            className="absolute inset-0 size-full rounded-none object-cover"
            label={`Source motion: ${motion.title}`}
            onTime={setTime}
            src={mediaUrl(source)}
          />
          <span className="absolute top-4 left-4">
            <Badge variant="solid">Source motion</Badge>
          </span>
        </div>
        <div className="relative overflow-hidden">
          {character && (
            <img
              alt={`Sample character: ${character.title ?? "a sample"}, an AI-generated image`}
              className="absolute inset-0 size-full object-cover"
              src={mediaUrl(character.image)}
            />
          )}
          <span className="absolute top-4 right-4">
            <Badge variant="solid">
              <StatusDot tone="brand" />
              Your character
            </Badge>
          </span>
        </div>
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-foreground/90"
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 grid size-11 -translate-1/2 place-items-center rounded-full bg-foreground text-primary-foreground shadow-modal"
        >
          <ChevronsLeftRightIcon className="size-5" />
        </span>
        <Viewfinder />
      </div>
      <figcaption className="text-sm text-muted-foreground">
        {motion.title} and {character?.title ?? "a sample character"}: pick them in Motion Transfer
        to render the take.
      </figcaption>
    </figure>
  );
}

/**
 * The studio's opening: the pitch, the way into Motion Transfer and, beside it, the result wall
 * of pre-rendered sample takes, or the split monitor before there is one.
 */
export function StudioHero({
  characters,
  motions,
  wall,
}: {
  characters: PickableCharacter[];
  motions: SampleMotion[];
  wall: WallTake[];
}) {
  return (
    <section
      className={cn(
        "mx-auto grid w-full max-w-330 items-center gap-14 px-4 pt-14 pb-20 sm:px-8 lg:grid-cols-2 lg:pt-16 lg:pb-26",
        // Beside the wall, the pitch stays at the top however many rows the wall grows to.
        wall.length > 0 && "lg:items-start",
      )}
    >
      <div className="flex min-w-0 flex-col gap-7">
        <span className="self-start">
          <Badge variant="brand">
            <StatusDot tone="brand" />
            Open source · Built on ComfyUI
          </Badge>
        </span>
        <h1 className="font-display text-5xl leading-none font-bold tracking-display text-balance sm:text-6xl xl:text-7xl">
          Make the shot.{" "}
          <span className="bg-linear-100 from-brand via-brand-mid to-brand-2 bg-clip-text text-transparent">
            Own the recipe.
          </span>
        </h1>
        <p className="max-w-xl text-lg text-pretty text-soft-foreground">
          Open Photon is an open-source studio for AI video effects. Start with Motion Transfer:
          give any character any move. Every render runs an open-weights workflow on Comfy, and
          keeps the recipe that made it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/motionTransfer">
              Start with Motion Transfer
              <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={`${REPOSITORY_URL}#run`}>Run it yourself</a>
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2.5 pt-2">
          <Hud>Wan Animate 2 · Apache-2.0</Hud>
          <Hud>MIT-licensed app</Hud>
          <Hud>Recipe on every render</Hud>
        </div>
      </div>
      {wall.length > 0 ? (
        <ResultWall takes={wall} />
      ) : (
        <HeroMonitor character={characters[0]} motion={motions[0]} />
      )}
    </section>
  );
}
