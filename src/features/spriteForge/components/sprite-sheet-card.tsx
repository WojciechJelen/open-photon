import { cn } from "cn";
import { DownloadIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Choice } from "#/features/spriteForge/components/choice";
import {
  FILLS_BOX,
  GeneratedTag,
  GenerationState,
  imageOutput,
  textOutput,
} from "#/features/spriteForge/components/generation-state";
import { GraphPaper } from "#/features/spriteForge/components/graph-paper";
import { SpritePlayground } from "#/features/spriteForge/components/sprite-playground";
import {
  type AtlasDescription,
  directionLabels,
  parseAtlasDescription,
  rowTag,
  SHEET_OUTPUTS,
  type SheetTakes,
  type SpriteSheet,
  spriteDirections,
  turnedDirections,
} from "#/features/spriteForge/contracts";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { Panel } from "#/shared/components/panel";
import { StateCard } from "#/shared/components/state-card";
import type { GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { HoldForCode } from "#/shared/use-access-code";
import { useLiveGeneration } from "#/shared/use-live-generation";
import { dayAndTime } from "#/shared/when";

type Variant = "hd" | "pixel";

const variants = {
  hd: { image: SHEET_OUTPUTS.hd, json: SHEET_OUTPUTS.hdJson, name: "HD", suffix: "hd" },
  pixel: {
    image: SHEET_OUTPUTS.pixel,
    json: SHEET_OUTPUTS.pixelJson,
    name: "pixel",
    suffix: "pixel",
  },
} as const;

const walkKeys = ["W", "A", "S", "D"];

/** One download: a link once there is something to fetch, disabled in the same box until then. */
function Download({
  fileName,
  href,
  label,
  name,
}: {
  fileName: string;
  href: string | null;
  label: string;
  /** The accessible name, which says what `label` leaves to the page around it. */
  name: string;
}) {
  return href ? (
    <Button asChild size="sm" variant="outline">
      <a aria-label={name} download={fileName} href={href} title={name}>
        <DownloadIcon aria-hidden="true" />
        {label}
      </a>
    </Button>
  ) : (
    <Button aria-label={name} disabled size="sm" variant="outline">
      <DownloadIcon aria-hidden="true" />
      {label}
    </Button>
  );
}

/** Downloads `atlas` as JSON, its `meta.image` naming the PNG it was saved beside. */
function AtlasJsonDownload({
  atlas,
  fileName,
  imageName,
  name,
}: {
  atlas: AtlasDescription | null;
  fileName: string;
  imageName: string;
  name: string;
}) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    if (!atlas) {
      return;
    }

    const text = JSON.stringify({ ...atlas, meta: { ...atlas.meta, image: imageName } }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));

    setHref(url);

    return () => URL.revokeObjectURL(url);
  }, [atlas, imageName]);

  return <Download fileName={fileName} href={atlas && href} label="Aseprite JSON" name={name} />;
}

/** The loop each direction kept: its take and seam ratio (`meta.loops`), when the atlas says. */
function LoopQuality({ atlas, takes }: { atlas: AtlasDescription; takes: SheetTakes }) {
  const loops = atlas.meta.loops;

  if (!loops?.length) {
    return null;
  }

  return (
    <Panel className="gap-3 p-4" label="Loop quality">
      <dl className="grid tiles-fit-40 gap-x-6 gap-y-2 text-sm wrap-anywhere">
        {spriteDirections.map((direction) => {
          const loop = loops.find((each) => each.tag === rowTag(direction));

          return loop ? (
            <div className="flex min-w-0 flex-col" key={direction}>
              <dt className="truncate type-caption text-muted-foreground">
                {directionLabels[direction]}
              </dt>
              <dd>
                {takes === 3 ? `Take ${loop.take} of 3 · seam` : "Seam"}{" "}
                {loop.seam_ratio.toFixed(2)}
              </dd>
            </div>
          ) : null;
        })}
      </dl>
      <p className="type-caption text-pretty wrap-anywhere text-muted-foreground">
        Seam: how far the loop&apos;s last frame jumps back to its first, against the motion within
        it; lower walks more smoothly. The east side mirrors the turned views.
      </p>
    </Panel>
  );
}

/**
 * A sheet's two cards, the same boxes from waiting to done: the atlas beside "Try it", which plays
 * it, with the downloads under them. Until the sheet is done the atlas box says how far it got.
 */
function SheetBody({
  backdrop,
  generation,
  name,
  onAccess,
  onRetried,
  slug,
  takes,
}: {
  backdrop?: string;
  generation: GenerationSnapshot;
  name: string;
  onAccess: HoldForCode;
  onRetried: () => void;
  slug: string;
  takes: SheetTakes;
}) {
  const atlases = useMemo(
    () => ({
      hd: parseAtlasDescription(textOutput(generation, variants.hd.json) ?? ""),
      pixel: parseAtlasDescription(textOutput(generation, variants.pixel.json) ?? ""),
    }),
    [generation],
  );

  const [picked, setPicked] = useState<Variant | null>(null);
  // The picture whose load failed; another one, or reloading it, starts out unfailed.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const shown = picked ?? (atlases.pixel || !atlases.hd ? "pixel" : "hd");
  const shownAtlas = atlases[shown];
  const shownImage = imageOutput(generation, variants[shown].image);
  const shownUrl = shownImage ? mediaUrl(shownImage) : null;
  const hdImage = imageOutput(generation, variants.hd.image);
  const pixelImage = imageOutput(generation, variants.pixel.image);
  const done = generation.status === "done";
  // The one atlas of two that could not be read; both unread is what "Nothing to play" says.
  const [unread, alsoUnread] = (["hd", "pixel"] as const).filter((variant) => !atlases[variant]);

  return (
    <>
      <div className="flex flex-wrap items-stretch gap-4">
        <Panel className="max-w-115 grow basis-95 gap-3.5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Choice
              label="Sheet style"
              onChange={setPicked}
              options={[
                { disabled: !atlases.hd, label: "HD", value: "hd" },
                { disabled: !atlases.pixel, label: "Pixel", value: "pixel" },
              ]}
              value={shown}
            />
            {shownUrl && shownUrl !== failedUrl && <GeneratedTag />}
          </div>
          <div className="relative aspect-4/5 overflow-hidden rounded-lg bg-field">
            <GraphPaper cell={32} />
            {!shownUrl ? (
              <GenerationState
                backdrop={backdrop}
                generation={generation}
                label="Sheet"
                onAccess={onAccess}
                onRetried={onRetried}
                what="sheet"
              />
            ) : shownUrl === failedUrl ? (
              <StateCard
                className={FILLS_BOX}
                heading="h3"
                icon={TriangleAlertIcon}
                text="The sheet's image could not be loaded."
                title="This sheet didn't load"
                tone="warning"
              >
                <Button onClick={() => setFailedUrl(null)} size="sm" variant="outline">
                  <RotateCwIcon aria-hidden="true" />
                  Reload the sheet
                </Button>
              </StateCard>
            ) : (
              <img
                alt={`${name}'s sprite sheet: eight directions of eight frames, ${GENERATED_IMAGE_ALT}`}
                className={cn(
                  "absolute inset-0 size-full object-contain",
                  shown === "pixel" && "pixelated",
                )}
                onError={() => setFailedUrl(shownUrl)}
                src={shownUrl}
              />
            )}
          </div>
        </Panel>
        <Panel className="grow-999 basis-80 gap-3.5 p-4">
          <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
            <h3 className="min-w-0 type-body font-semibold wrap-anywhere">Try it</h3>
            <span className="flex flex-wrap items-center gap-1 type-caption text-muted-foreground pointer-coarse:hidden">
              {walkKeys.map((key) => (
                <kbd
                  className="inline-flex size-7 items-center justify-center rounded-sm border border-input bg-foreground/5 font-mono text-xs font-semibold text-foreground"
                  key={key}
                >
                  {key}
                </kbd>
              ))}
              <span className="pl-1.5">to walk, 1–4 to zoom</span>
            </span>
            <span className="hidden type-caption text-muted-foreground pointer-coarse:inline">
              Walking needs a keyboard.
            </span>
          </div>
          <div className="relative min-h-108 flex-1 overflow-hidden rounded-lg bg-field">
            <GraphPaper cell={32} />
            {shownAtlas && shownUrl ? (
              <SpritePlayground atlas={shownAtlas} imageUrl={shownUrl} key={shown} />
            ) : done ? (
              <StateCard
                className={FILLS_BOX}
                heading="h3"
                icon={TriangleAlertIcon}
                text="This sheet's atlas description could not be read."
                title="Nothing to play"
                tone="warning"
              />
            ) : (
              <StateCard
                className={FILLS_BOX}
                frame
                heading="h3"
                text="Once the sheet is done."
                title="Your sprite walks here"
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Download
              fileName={`${slug}-walk-hd.png`}
              href={hdImage ? mediaUrl(hdImage) : null}
              label="HD PNG"
              name="Download HD PNG"
            />
            <Download
              fileName={`${slug}-walk-pixel.png`}
              href={pixelImage ? mediaUrl(pixelImage) : null}
              label="Pixel PNG"
              name="Download pixel PNG"
            />
            <AtlasJsonDownload
              atlas={shownAtlas}
              fileName={`${slug}-walk-${variants[shown].suffix}.json`}
              imageName={`${slug}-walk-${variants[shown].suffix}.png`}
              name={`Download ${variants[shown].name} Aseprite JSON`}
            />
          </div>
        </Panel>
      </div>
      {done && unread && !alsoUnread && (
        <p className="type-caption text-pretty text-muted-foreground">
          This sheet&apos;s {variants[unread].name} atlas description could not be read.
        </p>
      )}
      {shownAtlas && <LoopQuality atlas={shownAtlas} takes={takes} />}
    </>
  );
}

/** One sheet of the set: what it was asked for, then its atlas and playground. */
export function SheetCard({
  backdrop,
  name,
  onAccess,
  onRetried,
  sheet,
  slug,
}: {
  backdrop?: string;
  name: string;
  onAccess: HoldForCode;
  onRetried: () => void;
  sheet: SpriteSheet;
  slug: string;
}) {
  const { generation } = useLiveGeneration(sheet.generation);

  const facing = turnedDirections
    .map((direction) => `${directionLabels[direction]} faces ${sheet.facing[direction]}`)
    .join(" · ");

  return (
    <li className="flex min-w-0 flex-col gap-3">
      <p className="type-caption wrap-anywhere text-muted-foreground">
        {sheet.takes === 3 ? "Best of 3" : "Quick"} · {dayAndTime(sheet.created_at)} · {facing}
        {sheet.attempt > 0 ? ` · attempt ${sheet.attempt + 1}` : ""}
      </p>
      <SheetBody
        backdrop={backdrop}
        generation={generation}
        name={name}
        onAccess={onAccess}
        onRetried={onRetried}
        slug={slug}
        takes={sheet.takes}
      />
    </li>
  );
}
