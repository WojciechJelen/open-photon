import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, ChevronsLeftRightIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { PickableCharacter, SampleMotion } from "#/features/genjutsu/contracts";
import type { loadStudio } from "#/features/genjutsu/selection.functions";
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
 * The split monitor: the source motion on the left and, on the right, the pre-rendered sample
 * take's result when there is one, else a sample character (what you would pick to make it). A
 * REC readout runs with the clip. With no sample motion at all, it is left out.
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
  const [time, setTime] = useState(0);
  const source = take?.source ?? motion?.clip;

  if (!source) {
    return null;
  }

  const fps = Math.round(source.fps ?? 24);
  const motionTitle = take ? take.motionTitle : motion?.title;

  const caption = take
    ? `${motionTitle ?? "A sample motion"}, performed by ${take.characterTitle ?? "a sample character"}. Rendered with Wan Animate 2.`
    : `${motionTitle ?? "A sample motion"} and ${character?.title ?? "a sample character"}: pick them in Genjutsu to render the take.`;

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
            label={`Source motion: ${motionTitle ?? "a sample clip"}`}
            onTime={setTime}
            src={mediaUrl(source)}
          />
          <span className="absolute top-4 left-4">
            <Badge variant="solid">Source motion</Badge>
          </span>
        </div>
        <div className="relative overflow-hidden">
          {take ? (
            <LoopingVideo
              className="absolute inset-0 size-full rounded-none object-cover"
              label="Result: the sample character performing the same move"
              poster={take.poster ? mediaUrl(take.poster) : undefined}
              src={mediaUrl(take.result)}
            />
          ) : character ? (
            <img
              alt={`Sample character: ${character.title ?? "a sample"}`}
              className="absolute inset-0 size-full object-cover"
              src={mediaUrl(character.image)}
            />
          ) : null}
          <span className="absolute top-4 right-4">
            <Badge variant="solid">
              <StatusDot tone="brand" />
              {take ? "Result" : "Your character"}
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
      <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

/** The studio's opening: the pitch, the way into Genjutsu, and the split monitor. */
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
    <section className="mx-auto grid w-full max-w-330 items-center gap-14 px-4 pt-14 pb-20 sm:px-8 lg:grid-cols-2 lg:pt-20 lg:pb-26">
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
          Open Photon is an open-source studio for AI video effects. Start with Genjutsu: give any
          character any move. Every render runs an open-weights workflow on Comfy, and keeps the
          recipe that made it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/genjutsu">
              Start with Genjutsu
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
      <HeroMonitor character={characters[0]} motion={motions[0]} take={take} />
    </section>
  );
}
