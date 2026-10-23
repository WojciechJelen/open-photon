import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  CpuIcon,
  FileCodeIcon,
  LibraryIcon,
  LockOpenIcon,
  UserIcon,
} from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { PickableCharacter } from "#/features/characters";
import type { SampleMotion } from "#/features/motionTransfer/api";
import type { SampleTake } from "#/features/studio/components/studio-hero";
import { Hud, REPOSITORY_URL, StatusDot, Viewfinder } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import { mediaUrl } from "#/shared/media";
import { timecode } from "#/shared/timecode";

// Where the filmstrip stops the clip, in seconds.
const frameTimes = [1.5, 2.8, 4.2];

/** A still of a clip at `seconds`, framed. */
function Frame({ highlight, seconds, src }: { highlight?: boolean; seconds: number; src: string }) {
  return (
    <span
      className={
        highlight
          ? "relative aspect-3/4 overflow-hidden rounded-xl border border-brand/35 bg-screen"
          : "relative aspect-3/4 overflow-hidden rounded-xl border bg-screen"
      }
    >
      <ClipStill at={seconds} src={src} />
    </span>
  );
}

/**
 * The filmstrip on the Motion Transfer card: the sample motion stopped at three moments and, below, the
 * pre-rendered sample take at the same moments, or (before one is rendered) the sample characters
 * that can perform it.
 */
function Filmstrip({
  characters,
  motion,
  take,
}: {
  characters: PickableCharacter[];
  motion: SampleMotion | undefined;
  take: SampleTake | null;
}) {
  const source = take?.source ?? motion?.clip;

  if (!source) {
    return null;
  }

  return (
    <div aria-hidden="true" className="flex flex-col gap-2.5">
      <Hud>Motion</Hud>
      <div className="grid grid-cols-3 gap-2.5">
        {frameTimes.map((seconds) => (
          <Frame key={seconds} seconds={seconds} src={mediaUrl(source)} />
        ))}
      </div>
      <Hud tone="brand">{take ? "Result" : "Sample characters"}</Hud>
      <div className="grid grid-cols-3 gap-2.5">
        {take
          ? frameTimes.map((seconds) => (
              <Frame highlight key={seconds} seconds={seconds} src={mediaUrl(take.result)} />
            ))
          : characters.slice(0, 3).map((character) => (
              <span
                className="relative aspect-3/4 overflow-hidden rounded-xl border border-brand/35 bg-screen"
                key={character.id}
              >
                <img
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  src={mediaUrl(character.image)}
                />
              </span>
            ))}
      </div>
      {take && (
        <div className="grid grid-cols-3 gap-2.5 text-center">
          {frameTimes.map((seconds) => (
            <Hud key={seconds}>{timecode(seconds)}</Hud>
          ))}
        </div>
      )}
    </div>
  );
}

// The character tools beside Motion Transfer, live: the builder and the library.
const characterTools = [
  {
    icon: <UserIcon />,
    model: "FLUX 3 Image Klein",
    text: "Describe a character, refine the caption, and render a full-body photo ready for Motion Transfer.",
    title: "Describe a character",
    to: "/characters/new",
  },
  {
    icon: <LibraryIcon />,
    model: "Workspace library",
    text: "Find, favorite and rename the workspace's characters, uploaded or generated, and animate any of them.",
    title: "Character library",
    to: "/characters",
  },
] as const;

/**
 * The tool grid: Motion Transfer, live and featured (the whole card opens it), then the character
 * tools, each card a link to its page.
 */
export function StudioTools({
  characters,
  motions,
  take,
}: {
  characters: PickableCharacter[];
  motions: SampleMotion[];
  take: SampleTake | null;
}) {
  return (
    <section
      aria-labelledby="tools-heading"
      className="mx-auto flex w-full max-w-330 scroll-mt-6 flex-col gap-8 px-4 pb-28 sm:px-8"
      id="tools"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Hud>Tools</Hud>
          <h2
            className="font-display text-3xl leading-tight font-bold tracking-display sm:text-4xl"
            id="tools-heading"
          >
            Pick a tool. Make a shot.
          </h2>
        </div>
        <p className="max-w-sm text-sm text-soft-foreground">
          New tools land here as they ship. Each one runs its own open workflow, and its recipe is
          public.
        </p>
      </div>

      <Link
        className="group flex flex-col overflow-hidden rounded-3xl border bg-linear-to-b from-foreground/4 to-foreground/1 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring lg:flex-row"
        to="/motionTransfer"
      >
        <div className="relative p-6 sm:p-7 lg:w-3/5">
          <Filmstrip characters={characters} motion={motions[0]} take={take} />
        </div>
        <div className="flex flex-col justify-center gap-5 border-t p-7 sm:p-10 lg:w-2/5 lg:border-t-0 lg:border-l">
          <div className="flex flex-wrap gap-2">
            <Badge>
              <StatusDot tone="ok" />
              Live
            </Badge>
            <Badge>Motion transfer</Badge>
          </div>
          <h3 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
            Motion Transfer
          </h3>
          <p className="text-base text-soft-foreground">
            Pick a move, add a photo of a character, and watch them perform it. Reshoot it from
            another angle if you like.
          </p>
          <ol className="flex flex-col gap-2.5">
            {[
              "Pick a motion",
              "Add a character",
              "Direct the shot: angle and look",
              "Render, compare, share",
            ].map((item, index) => (
              <li className="flex items-center gap-3" key={item}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full border border-input font-mono text-xs text-soft-foreground">
                  {index + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Button asChild size="lg" variant="photon">
              <span>
                Open Motion Transfer
                <ArrowRightIcon />
              </span>
            </Button>
            <Hud>Wan Animate 2 · 3–8 s clips</Hud>
          </div>
        </div>
      </Link>

      <ul aria-label="Character tools" className="grid gap-4 md:grid-cols-2">
        {characterTools.map((tool) => (
          <li key={tool.title}>
            <Link
              className="flex h-full flex-col overflow-hidden rounded-3xl border bg-linear-to-b from-foreground/4 to-foreground/1 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
              to={tool.to}
            >
              <div className="relative grid h-42 place-items-center border-b">
                <span
                  aria-hidden="true"
                  className="grid size-16 place-items-center rounded-full border border-brand/35 bg-brand/12 text-brand-foreground *:size-7"
                >
                  {tool.icon}
                </span>
                <Viewfinder tone="dim" />
              </div>
              <div className="flex flex-col gap-2.5 p-6">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-xl font-semibold">{tool.title}</h3>
                  <Badge>
                    <StatusDot tone="ok" />
                    Live
                  </Badge>
                </div>
                <p className="text-sm text-soft-foreground">{tool.text}</p>
                <Hud className="pt-1.5">{tool.model}</Hud>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Built open": what the open approach means, each claim one the repository backs. */
export function BuiltOpen() {
  const points = [
    {
      icon: <LockOpenIcon />,
      text: "No partner nodes and no closed APIs. Every share page lists the model files its workflow loads.",
      title: "Open weights, end to end",
    },
    {
      icon: <FileCodeIcon />,
      text: "Workflow, seed, prompt and input hashes travel with the video. Re-run a finished recipe and you get the same video back.",
      title: "Every render keeps its recipe",
    },
    {
      icon: <CpuIcon />,
      text: "Clone it and start it with Docker Compose. Renders go to Comfy Cloud on your own key, or to a ComfyUI server you point it at.",
      title: "Run it yourself",
    },
  ];

  return (
    <section aria-labelledby="open-heading" className="border-y bg-popover">
      <div className="mx-auto flex w-full max-w-330 flex-col gap-10 px-4 py-20 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-3">
            <Hud>Built open</Hud>
            <h2
              className="font-display text-3xl leading-tight font-bold tracking-display sm:text-4xl"
              id="open-heading"
            >
              Nothing behind a curtain.
            </h2>
          </div>
          <code className="max-w-full overflow-x-auto rounded-xl border border-input bg-background px-4 py-3 font-mono text-sm text-soft-foreground">
            git clone {REPOSITORY_URL}
          </code>
        </div>
        <div className="grid gap-10 md:grid-cols-3">
          {points.map((point) => (
            <div className="flex flex-col gap-3" key={point.title}>
              <span aria-hidden="true" className="text-brand *:size-6">
                {point.icon}
              </span>
              <h3 className="font-display text-xl font-semibold">{point.title}</h3>
              <p className="text-sm text-soft-foreground">{point.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
