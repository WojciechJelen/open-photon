import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowRightIcon, EqualIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import type { PickableCharacter } from "#/features/characters";
import type { SampleMotion } from "#/features/motionTransfer/api";
import anglesCloseUp from "#/features/studio/assets/angles-close-up.webp";
import anglesFront from "#/features/studio/assets/angles-front.webp";
import anglesProfile from "#/features/studio/assets/angles-profile.webp";
import anglesThreeQuarter from "#/features/studio/assets/angles-three-quarter.webp";
import animateStill from "#/features/studio/assets/animate-still.webp";
import animateWave from "#/features/studio/assets/animate-wave.webp";
import batchesMaya from "#/features/studio/assets/batches-maya.webp";
import batchesSelfHost from "#/features/studio/assets/batches-self-host.webp";
import batchesStylized from "#/features/studio/assets/batches-stylized.webp";
import createMaya from "#/features/studio/assets/create-maya.webp";
import createTheo from "#/features/studio/assets/create-theo.webp";
import createYuki from "#/features/studio/assets/create-yuki.webp";
import photoshootStairs from "#/features/studio/assets/photoshoot-stairs.webp";
import photoshootStreet from "#/features/studio/assets/photoshoot-street.webp";
import photoshootStudio from "#/features/studio/assets/photoshoot-studio.webp";
import presetsRooftop from "#/features/studio/assets/presets-golden-hour-rooftop.webp";
import presetsNeonNight from "#/features/studio/assets/presets-neon-night.webp";
import presetsStreetDance from "#/features/studio/assets/presets-street-dance.webp";
import productPlinth from "#/features/studio/assets/product-plinth.webp";
import productTable from "#/features/studio/assets/product-table.webp";
import spriteKenji from "#/features/studio/assets/sprite-kenji.webp";
import spriteSheet from "#/features/studio/assets/sprite-sheet.webp";
import storyboard1 from "#/features/studio/assets/storyboard-1.webp";
import storyboard2 from "#/features/studio/assets/storyboard-2.webp";
import storyboard3 from "#/features/studio/assets/storyboard-3.webp";
import storyboard4 from "#/features/studio/assets/storyboard-4.webp";
import { AiTag } from "#/features/studio/components/ai-tag";
import { type SampleTake, STILL_AT } from "#/features/studio/components/studio-hero";
import { Hud, Viewfinder } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import { mediaUrl } from "#/shared/media";

const media = "absolute inset-0 size-full object-cover";

const row =
  "group flex min-w-0 items-center gap-3 rounded-xl border bg-card/72 py-2 pr-3 pl-2 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring";

const thumbnail = "relative h-18 w-15 shrink-0 overflow-hidden rounded-md bg-screen";

const arrow = "size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground";

/**
 * The tools of the Image and Video groups. `short` and `thumb` are a phone's row, `text` and
 * `pictures` the card from `md` up, laid out by `grid`; `fit` is how each picture sits in its box.
 * `alt` is the text of either: these illustrate a tool, so that is where they say what they are.
 */
const imageTools = [
  {
    alt: "Sample characters, AI-generated images",
    fit: "object-top",
    grid: "grid-cols-3",
    pictures: [createMaya, createYuki, createTheo],
    short: "From a description",
    text: "Describe someone, get a full-body portrait.",
    thumb: createYuki,
    title: "Create character",
    to: "/characters/new",
  },
  {
    alt: "Arthur photographed in new settings, AI-generated images",
    fit: "object-top",
    grid: "grid-cols-3",
    pictures: [photoshootStudio, photoshootStreet, photoshootStairs],
    short: "Four new photos",
    text: "Four new photos of one character.",
    thumb: photoshootStairs,
    title: "Photoshoot",
    to: "/photoshoot",
  },
  {
    alt: "Maya seen from different sides, AI-generated images",
    fit: "object-top",
    grid: "grid-cols-4",
    pictures: [anglesFront, anglesThreeQuarter, anglesProfile, anglesCloseUp],
    short: "Every side of a character",
    text: "See a character from every side.",
    thumb: anglesThreeQuarter,
    title: "Shots & Angles",
    to: "/angles",
  },
  {
    alt: "Maya in scenes on a rooftop, AI-generated images",
    fit: "object-center",
    grid: "grid-cols-2 grid-rows-2",
    pictures: [storyboard1, storyboard2, storyboard3, storyboard4],
    short: "Four scenes",
    text: "A short sequence in four scenes.",
    thumb: storyboard2,
    title: "Storyboard",
    to: "/storyboards",
  },
  {
    alt: "Kenji as a walk-cycle sprite, AI-generated images",
    // Crisp only where the tile is as wide as the sheet: shrunk, nearest-neighbour drops pixels.
    fit: "bg-card object-top xl:pixelated",
    grid: "grid-cols-1",
    pictures: [spriteSheet],
    short: "Walk cycles for games",
    text: "An 8-direction walk cycle for games.",
    thumb: spriteKenji,
    title: "Sprite Forge",
    to: "/sprites",
  },
  {
    alt: "A steel bottle in two settings, AI-generated images",
    fit: "object-center",
    grid: "grid-cols-2",
    pictures: [productTable, productPlinth],
    short: "Packshots and ad scenes",
    text: "Packshots, lifestyle and ad scenes.",
    thumb: productTable,
    title: "Product Studio",
    to: "/product-studio",
  },
] as const;

const videoTools = [
  {
    alt: "Sample takes of a dance, AI-generated video frames",
    fit: "object-top",
    grid: "grid-cols-3",
    pictures: [presetsNeonNight, presetsStreetDance, presetsRooftop],
    short: "Ready-made shots",
    text: "Ready-made shots. Add your character.",
    thumb: presetsNeonNight,
    title: "Motion presets",
    to: "/presets",
  },
  {
    alt: "Maya waving, AI-generated video frames",
    fit: "object-top",
    grid: "grid-cols-2",
    pictures: [animateStill, animateWave],
    short: "Bring a still to life",
    text: "Bring a still to life with a sentence.",
    thumb: animateWave,
    title: "Animate image",
    to: "/animate",
  },
  {
    alt: "Variations of a dance, AI-generated video frames",
    fit: "object-top",
    grid: "grid-cols-3",
    pictures: [batchesMaya, batchesSelfHost, batchesStylized],
    short: "Compare variations",
    text: "Render variations and compare them.",
    thumb: batchesMaya,
    title: "Batches",
    to: "/batches",
  },
] as const;

/** A tool's name and its line, a short one on a phone. */
function ToolName({ short, text, title }: { short: string; text?: string; title: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col md:gap-0.5">
      <span className="truncate font-semibold text-foreground md:text-base">{title}</span>
      <span className="truncate type-caption text-muted-foreground md:hidden">{short}</span>
      {text && (
        <span className="line-clamp-2 text-sm wrap-anywhere text-muted-foreground max-md:hidden">
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * A tool: on a phone a row beside one picture, from `md` up a card under its pictures. A last row
 * alone takes the width while the rows are in two columns.
 */
function ToolTile({ tool }: { tool: (typeof imageTools)[number] | (typeof videoTools)[number] }) {
  return (
    <li className="min-w-0 sm:max-md:last:odd:col-span-2">
      <Link
        className={cn(
          row,
          "h-full md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-2xl md:p-0",
        )}
        to={tool.to}
      >
        <span className={cn(thumbnail, "md:aspect-16/10 md:h-auto md:w-full md:rounded-none")}>
          <img
            alt={tool.alt}
            className={cn(media, tool.fit, "md:hidden")}
            loading="lazy"
            src={tool.thumb}
          />
          <span
            aria-label={tool.alt}
            className={cn("absolute inset-0 grid gap-0.5 max-md:hidden", tool.grid)}
            role="img"
          >
            {tool.pictures.map((picture) => (
              <span className="relative overflow-hidden" key={picture}>
                <img alt="" className={cn(media, tool.fit)} loading="lazy" src={picture} />
              </span>
            ))}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:px-4.5 md:py-4">
          <ToolName short={tool.short} text={tool.text} title={tool.title} />
          <ArrowRightIcon aria-hidden="true" className={arrow} strokeWidth={1.75} />
        </span>
      </Link>
    </li>
  );
}

/** One group of tools under its HUD label, which a phone leaves out: there it is one list. */
function ToolGroup({
  label,
  tools,
}: {
  label: string;
  tools: typeof imageTools | typeof videoTools;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Hud className="max-md:hidden" tone="soft">
        {label}
      </Hud>
      <ul
        aria-label={`${label} tools`}
        className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 md:gap-4"
      >
        {tools.map((tool) => (
          <ToolTile key={tool.title} tool={tool} />
        ))}
      </ul>
    </div>
  );
}

/** One term of the card's sum: a 9:16 picture over its HUD caption. */
function CardTerm({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-2.5">
      <div className="relative aspect-9/16 overflow-hidden rounded-field border bg-screen">
        {children}
      </div>
      <figcaption>
        <Hud>{caption}</Hud>
      </figcaption>
    </figure>
  );
}

/**
 * Motion Transfer, featured: the whole card opens it. The sum is the sample take's clip, character
 * and result, or (before one is rendered) a sample motion, a sample character and an empty frame.
 * A phone has a plain first row in the list instead.
 */
function MotionTransferCard({
  character,
  motion,
  take,
}: {
  character: PickableCharacter | undefined;
  motion: SampleMotion | undefined;
  take: SampleTake | null;
}) {
  const source = take?.source ?? motion?.clip;
  const still = take?.poster ?? character?.image;

  return (
    <>
      <Link className={cn(row, "md:hidden")} to="/motionTransfer">
        <span className={thumbnail}>
          {still && (
            <img
              alt="A sample of Motion Transfer, an AI-generated image"
              className={cn(media, "object-top")}
              src={mediaUrl(still)}
            />
          )}
        </span>
        <ToolName short="Any character, any move" title="Motion Transfer" />
        <ArrowRightIcon aria-hidden="true" className={arrow} strokeWidth={1.75} />
      </Link>
      <Link
        className="group flex flex-wrap items-center gap-8 rounded-2xl border bg-card/72 p-7 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring max-md:hidden"
        to="/motionTransfer"
      >
        <div className="flex min-w-0 grow basis-100 items-center gap-3 xl:basis-140">
          <CardTerm caption="A move">
            {source && <ClipStill at={STILL_AT} src={mediaUrl(source)} />}
          </CardTerm>
          <PlusIcon aria-hidden="true" className="mb-6.5 size-4.5 shrink-0 text-muted-foreground" />
          <CardTerm caption="A character">
            {character && (
              <img
                alt={`${character.title ?? "Sample character"}, an AI-generated image`}
                className={media}
                src={mediaUrl(character.image)}
              />
            )}
          </CardTerm>
          <EqualIcon
            aria-hidden="true"
            className="mb-6.5 size-4.5 shrink-0 text-muted-foreground"
          />
          <CardTerm caption="Your take">
            {take ? (
              <>
                <ClipStill at={STILL_AT} src={mediaUrl(take.result)} />
                <AiTag className="bottom-2 left-2" />
              </>
            ) : (
              <Viewfinder tone="dim" />
            )}
          </CardTerm>
        </div>
        <div className="flex min-w-0 grow basis-80 flex-col items-start gap-4 px-5">
          <h3 className="max-w-full font-display text-4xl font-bold tracking-display wrap-anywhere">
            Motion Transfer
          </h3>
          <p className="max-w-full text-base text-pretty wrap-anywhere text-soft-foreground">
            Pick a move, add a character and watch them perform it.
          </p>
          <Button asChild>
            <span>
              <span>Open Motion Transfer</span>
              <ArrowRightIcon />
            </span>
          </Button>
        </div>
      </Link>
    </>
  );
}

/** "Pick a tool": Motion Transfer, featured, then every other tool by what it makes. */
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
      className="flex scroll-mt-6 flex-col gap-2.5 sm:mt-14 md:gap-6"
      id="tools"
    >
      <h2 className="mb-1.5 type-heading wrap-anywhere md:mb-0" id="tools-heading">
        Pick a tool<span className="max-md:hidden">. Make a shot.</span>
      </h2>
      <MotionTransferCard
        character={characters.find(({ title }) => title === take?.characterTitle) ?? characters[0]}
        motion={motions[0]}
        take={take}
      />
      <div className="flex flex-col gap-2.5 md:mt-4 md:gap-10">
        <ToolGroup label="Image" tools={imageTools} />
        <ToolGroup label="Video" tools={videoTools} />
      </div>
    </section>
  );
}
