import { Link } from "@tanstack/react-router";
import { DownloadIcon, HammerIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import { SpritePlayground } from "#/features/spriteForge/components/sprite-playground";
import {
  type AtlasDescription,
  defaultFacing,
  directionLabels,
  type Facing,
  parseAtlasDescription,
  rowTag,
  type SheetFacing,
  SHEET_OUTPUTS,
  type SheetTakes,
  type SpriteSet,
  type SpriteSetView,
  type SpriteSheet,
  spriteDirections,
  turnedDirections,
  VIEW_OUTPUT,
} from "#/features/spriteForge/contracts";
import {
  fetchSpriteSet,
  postSpriteSheet,
  retryGeneration,
} from "#/features/spriteForge/sprite-client";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { SiteHeader } from "#/shared/components/site";
import type { GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { type HoldForCode, useAccessCode } from "#/shared/use-access-code";
import { isFinished, useLiveGeneration } from "#/shared/use-live-generation";

// How often the set is read again while one of its generations is still on its way.
const REREAD_MS = 4000;

type Page =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; set: SpriteSet };

function pageOf(result: { data: SpriteSet } | { refusal: Refusal }): Page {
  if ("data" in result) {
    return { kind: "ready", set: result.data };
  }

  switch (result.refusal.reason) {
    case "access_required":
      return { kind: "access" };
    case "not_found":
      return { kind: "missing" };
    default:
      return { kind: "error", message: result.refusal.message };
  }
}

/**
 * `GET /api/sprite-sets/:id`, read once, on `reload`, and `REREAD_MS` after each read settles
 * while a view or a sheet is unfinished: whether every view is done decides whether a sheet can be
 * forged, and a retry's child is followed only through the set. The next re-read waits for the
 * current one, so a slow server still moves the set along. A failed re-read keeps the set on the
 * page. `show` puts a set the server just answered with in place.
 */
function useSpriteSet(id: string) {
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [reads, reload] = useReducer((count: number) => count + 1, 0);
  const [settled, settle] = useReducer((count: number) => count + 1, 0);
  const reading = useRef(false);

  const following =
    page.kind === "ready" &&
    [...page.set.views, ...page.set.sheets].some(
      ({ generation }) => !isFinished(generation.status),
    );

  useEffect(() => {
    const controller = new AbortController();

    reading.current = true;
    void fetchSpriteSet(id, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        reading.current = false;
        setPage((previous) =>
          previous.kind === "ready" && "refusal" in result ? previous : pageOf(result),
        );
        settle();
      }
    });

    return () => controller.abort();
  }, [id, reads]);

  useEffect(() => {
    if (!following) {
      return;
    }

    // A read still out (one `reload` started) schedules the next re-read when it settles.
    const timer = setTimeout(() => {
      if (!reading.current) {
        reload();
      }
    }, REREAD_MS);

    return () => clearTimeout(timer);
  }, [following, settled]);

  const show = useCallback((set: SpriteSet) => setPage({ kind: "ready", set }), []);

  return { page, reload, show };
}

const fixedLabels = {
  cancelled: "Cancelled",
  done: "Done",
  failed: "Failed",
  finalizing: "Saving…",
  preparing: "Starting…",
  unknown: "Unknown",
} as const;

/** A generation's state in words, for its badge, its card's name and while it has no result. */
function statusText({ position, progress, status }: GenerationSnapshot) {
  if (status === "waiting") {
    return position ? `Waiting · ${position} in line` : "Waiting";
  }

  if (status === "queued" || status === "running") {
    return progress === null ? "Queued on Comfy" : `Rendering ${progress}%`;
  }

  return fixedLabels[status];
}

function isFailed({ status }: GenerationSnapshot) {
  return status === "failed" || status === "cancelled";
}

/** The image a done generation saved as `name`, if it saved one. */
function imageOutput(generation: GenerationSnapshot, name: string) {
  for (const output of generation.outputs) {
    if (output.name === name && output.media === "image") {
      return output.asset;
    }
  }

  return undefined;
}

/** The text a done generation saved as `name`, if it saved one. */
function textOutput(generation: GenerationSnapshot, name: string) {
  for (const output of generation.outputs) {
    if (output.name === name && output.media === "text") {
      return output.text;
    }
  }

  return undefined;
}

/** The start of every download's name: the character's title as a slug (`maya-chen`). */
function slugOf(title: string | null | undefined) {
  const slug = (title ?? "")
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replaceAll(/^-+|-+$/g, "");

  return slug || "character";
}

/** The shared retry of one failed generation, holding it for the access code when one is due. */
function useRetry(generationId: string, hold: HoldForCode, onRetried: () => void) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setProblem(null);

    const result = await retryGeneration(generationId);

    setBusy(false);

    if ("data" in result) {
      onRetried();
    } else if (result.refusal.reason === "access_required") {
      hold(`retry-${generationId}`, "retry", () => void retry());
    } else {
      setProblem(result.refusal.message);
    }
  }

  return { busy, problem, retry };
}

function RetryButton({
  busy,
  label,
  onRetry,
}: {
  busy: boolean;
  label: string;
  onRetry: () => void;
}) {
  return (
    <Button aria-label={label} disabled={busy} onClick={onRetry} size="sm" variant="outline">
      <RotateCwIcon />
      {busy ? "Retrying…" : "Retry"}
    </Button>
  );
}

/** One choice among a few, as a radio group named by its visible `label`. */
function Choice<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly { disabled?: boolean; label: string; value: T }[];
  value: T;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-soft-foreground" id={id}>
        {label}
      </span>
      {/* Scrolls rather than overflow the card when the choices outgrow it. */}
      <div className="-m-1 overflow-x-auto p-1">
        <ToggleGroup
          aria-labelledby={id}
          onValueChange={(next) => {
            const picked = options.find((option) => option.value === next);

            if (picked) {
              onChange(picked.value);
            }
          }}
          spacing={1}
          type="single"
          value={value}
          variant="segmented"
        >
          {options.map((option) => (
            <ToggleGroupItem disabled={option.disabled} key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

const facingOptions = [
  { label: "Faces left", value: "left" },
  { label: "Faces right", value: "right" },
] as const satisfies readonly { label: string; value: Facing }[];

/**
 * One direction of the set: its state, its view once done, and for a turned view which side of
 * the screen the character faces (the sheet flips rows from it, so a wrong guess walks backwards).
 */
function ViewCard({
  facing,
  onAccess,
  onFacing,
  onRetried,
  view,
}: {
  facing: Facing | null;
  onAccess: HoldForCode;
  onFacing: (facing: Facing) => void;
  onRetried: () => void;
  view: SpriteSetView;
}) {
  const { generation } = useLiveGeneration(view.generation);
  const { busy, problem, retry } = useRetry(generation.id, onAccess, onRetried);
  const label = directionLabels[view.direction];
  const status = statusText(generation);
  const image = imageOutput(generation, VIEW_OUTPUT);

  return (
    <li
      aria-label={`${label}: ${status}`}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-foreground/2 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{label}</h3>
        <Badge variant={generation.status === "done" ? "brand" : "default"}>{status}</Badge>
      </div>
      <div className="relative flex aspect-3/5 items-center justify-center overflow-hidden rounded-xl bg-foreground/5 p-3 text-center text-sm text-soft-foreground">
        {image ? (
          <img
            alt={`${label} view, ${GENERATED_IMAGE_ALT}`}
            className="absolute inset-0 size-full object-contain"
            src={mediaUrl(image)}
          />
        ) : isFailed(generation) ? (
          <span className="flex flex-col items-center gap-2">
            <TriangleAlertIcon aria-hidden="true" className="size-5 text-destructive-foreground" />
            <span className="line-clamp-6">{generation.error_message ?? "This view failed."}</span>
          </span>
        ) : generation.status === "unknown" ? (
          <span className="line-clamp-8">
            Comfy may have accepted this view before its job was saved, so it is never sent again on
            its own.
          </span>
        ) : (
          <div className="w-3/4">
            <Progress aria-label={`${label} progress`} value={generation.progress ?? 0} />
          </div>
        )}
      </div>
      {view.reused && generation.status === "done" && (
        <p className="text-xs text-muted-foreground">Already rendered: came back free.</p>
      )}
      {facing && (
        <Choice
          label={`${label} facing`}
          onChange={onFacing}
          options={facingOptions}
          value={facing}
        />
      )}
      {isFailed(generation) && (
        <RetryButton busy={busy} label={`Retry ${label}`} onRetry={() => void retry()} />
      )}
      {problem && (
        <p className="text-xs text-destructive-foreground" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

const takesOptions = [
  { label: "Best of 3 (cleaner loops)", value: "3" },
  { label: "Quick (1 take)", value: "1" },
] as const;

/** Where a sheet's settings are chosen and it is forged; it waits for all five views. */
function ForgePanel({
  available,
  onForge,
  onTakes,
  pending,
  problem,
  ready,
  takes,
}: {
  available: boolean;
  onForge: () => void;
  onTakes: (takes: SheetTakes) => void;
  pending: boolean;
  problem: string | null;
  ready: boolean;
  takes: SheetTakes;
}) {
  const id = useId();

  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-2xl border bg-foreground/2 p-5"
    >
      <h2 className="font-display text-2xl font-semibold" id={id}>
        Forge a sprite sheet
      </h2>
      <p className="max-w-3xl text-sm text-soft-foreground">
        Each direction walks in a Wan 2.2 clip that starts and ends on its view; the Sprite Forge
        nodes cut the cleanest loop, lock the feet in place, mirror the turned views into the east
        and pack an HD and a pixel-art atlas with Aseprite JSON. Best of 3 renders three clips per
        direction and keeps the smoothest loop.
      </p>
      <Choice
        label="Takes per direction"
        onChange={(value) => onTakes(value === "1" ? 1 : 3)}
        options={takesOptions}
        value={takes === 1 ? "1" : "3"}
      />
      {!available && (
        <p className="max-w-3xl rounded-xl border p-3 text-sm text-soft-foreground">
          Sprite sheets run the Sprite Forge custom nodes, which only a self-hosted ComfyUI has.
          Point <code>COMFY_BASE_URL</code> at your own GPU (see the self-host section of the Sprite
          Forge README) to forge one.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          disabled={!available || !ready || pending}
          onClick={onForge}
          size="lg"
          variant="photon"
        >
          <HammerIcon />
          Forge sprite sheet
        </Button>
        {available && !ready && (
          <p className="text-sm text-muted-foreground">
            Every direction must be done first; retry a failed one.
          </p>
        )}
        {problem && (
          <p className="text-sm text-destructive-foreground" role="alert">
            {problem}
          </p>
        )}
      </div>
    </section>
  );
}

/** A link that downloads `atlas` as JSON, its `meta.image` naming the PNG it was saved beside. */
function AtlasJsonLink({
  atlas,
  fileName,
  imageName,
  label,
}: {
  atlas: AtlasDescription;
  fileName: string;
  imageName: string;
  label: string;
}) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const text = JSON.stringify({ ...atlas, meta: { ...atlas.meta, image: imageName } }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));

    setHref(url);

    return () => URL.revokeObjectURL(url);
  }, [atlas, imageName]);

  if (!href) {
    return null;
  }

  return (
    <Button asChild size="sm" variant="outline">
      <a download={fileName} href={href}>
        <DownloadIcon />
        {label}
      </a>
    </Button>
  );
}

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

/** The loop each direction kept: its take and seam ratio (`meta.loops`), when the atlas says. */
function LoopQuality({ atlas, takes }: { atlas: AtlasDescription; takes: SheetTakes }) {
  const loops = atlas.meta.loops;

  if (!loops?.length) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Loop quality</p>
      <dl className="flex max-w-sm flex-col gap-1 text-sm">
        {spriteDirections.map((direction) => {
          const loop = loops.find((each) => each.tag === rowTag(direction));

          return loop ? (
            <div className="flex justify-between gap-4" key={direction}>
              <dt className="text-soft-foreground">{directionLabels[direction]}</dt>
              <dd>
                {takes === 3 ? `take ${loop.take} of 3 · ` : ""}seam {loop.seam_ratio.toFixed(2)}
              </dd>
            </div>
          ) : null;
        })}
      </dl>
      <p className="text-xs text-muted-foreground">
        Seam: how far the loop&apos;s last frame jumps back to its first, against the motion within
        it; lower walks more smoothly. The east side mirrors the turned views.
      </p>
    </div>
  );
}

/** A done sheet: its downloads, and its atlases played and scored on the page. */
function SheetResult({
  generation,
  slug,
  takes,
}: {
  generation: GenerationSnapshot;
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

  const [shown, setShown] = useState<Variant>(atlases.hd || !atlases.pixel ? "hd" : "pixel");
  const shownImage = imageOutput(generation, variants[shown].image);
  const shownAtlas = atlases[shown];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(["hd", "pixel"] as const).map((variant) => {
          const { image, name, suffix } = variants[variant];
          const asset = imageOutput(generation, image);
          const atlas = atlases[variant];
          const imageName = `${slug}-walk-${suffix}.png`;

          return (
            <div className="contents" key={variant}>
              {asset && (
                <Button asChild size="sm" variant="outline">
                  <a download={imageName} href={mediaUrl(asset)}>
                    <DownloadIcon />
                    Download {name} PNG
                  </a>
                </Button>
              )}
              {atlas && (
                <AtlasJsonLink
                  atlas={atlas}
                  fileName={`${slug}-walk-${suffix}.json`}
                  imageName={imageName}
                  label={`Download ${name} JSON`}
                />
              )}
            </div>
          );
        })}
      </div>
      {(!atlases.hd || !atlases.pixel) && (
        <p className="text-sm text-soft-foreground">
          This sheet&apos;s atlas description could not be read.
        </p>
      )}
      {(atlases.hd || atlases.pixel) && (
        <>
          <Choice
            label="Playground atlas"
            onChange={setShown}
            options={[
              { disabled: !atlases.hd, label: "HD", value: "hd" },
              { disabled: !atlases.pixel, label: "Pixel", value: "pixel" },
            ]}
            value={shown}
          />
          {shownAtlas && shownImage && (
            <SpritePlayground atlas={shownAtlas} imageUrl={mediaUrl(shownImage)} key={shown} />
          )}
          {shownAtlas && <LoopQuality atlas={shownAtlas} takes={takes} />}
        </>
      )}
    </div>
  );
}

/** One sheet of the set: what it was asked for, its state, and once done what it made. */
function SheetCard({
  onAccess,
  onRetried,
  sheet,
  slug,
}: {
  onAccess: HoldForCode;
  onRetried: () => void;
  sheet: SpriteSheet;
  slug: string;
}) {
  const { generation } = useLiveGeneration(sheet.generation);
  const { busy, problem, retry } = useRetry(generation.id, onAccess, onRetried);
  const status = statusText(generation);

  const facing = turnedDirections
    .map((direction) => `${directionLabels[direction]} faces ${sheet.facing[direction]}`)
    .join(" · ");

  return (
    <li className="flex flex-col gap-4 rounded-2xl border bg-foreground/2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">
            Walk cycle · {sheet.takes === 3 ? "best of 3" : "1 take"} ·{" "}
            {new Date(sheet.created_at).toLocaleString()}
          </h3>
          <p className="text-xs text-muted-foreground">
            {facing}
            {sheet.attempt > 0 ? ` · attempt ${sheet.attempt + 1}` : ""}
          </p>
        </div>
        <Badge variant={generation.status === "done" ? "brand" : "default"}>{status}</Badge>
      </div>
      {generation.status === "done" ? (
        <SheetResult generation={generation} slug={slug} takes={sheet.takes} />
      ) : isFailed(generation) ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive-foreground">
            {generation.error_message ?? "This sheet failed."}
          </p>
          <RetryButton busy={busy} label="Retry sheet" onRetry={() => void retry()} />
        </div>
      ) : generation.status === "unknown" ? (
        <p className="text-sm text-soft-foreground">
          Comfy may have accepted this sheet before its job was saved, so it is never sent again on
          its own.
        </p>
      ) : (
        <Progress aria-label="Sheet progress" value={generation.progress ?? 0} />
      )}
      {problem && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

/** The page while it has no set: loading, the code needed, no such set, or a failed read. */
function Notice({
  onAccess,
  onRetry,
  page,
}: {
  onAccess: () => void;
  onRetry: () => void;
  page: Exclude<Page, { kind: "ready" }>;
}) {
  if (page.kind === "loading") {
    return (
      <p className="text-muted-foreground" role="status">
        Loading the sprite set…
      </p>
    );
  }

  return (
    <section
      className="flex flex-col items-start gap-4"
      role={page.kind === "error" ? "alert" : undefined}
    >
      <h1 className="font-display text-4xl font-bold tracking-display">
        {page.kind === "missing" ? "Sprite set not found" : "Sprite set"}
      </h1>
      {page.kind === "access" && (
        <>
          <p className="text-soft-foreground">Enter the access code to see it.</p>
          <Button onClick={onAccess} variant="outline">
            Enter code
          </Button>
        </>
      )}
      {page.kind === "error" && (
        <>
          <p className="text-soft-foreground">{page.message}</p>
          <Button onClick={onRetry} variant="outline">
            Try again
          </Button>
        </>
      )}
      {page.kind === "missing" && (
        <>
          <p className="text-soft-foreground">No sprite set has this link.</p>
          <Link className="underline underline-offset-3" to="/sprites">
            Sprite Forge
          </Link>
        </>
      )}
    </section>
  );
}

/** A loaded set: its views with the facing of the turned ones, the forge panel and its sheets. */
function LoadedSet({
  onAccess,
  onRetried,
  onSheet,
  set,
}: {
  onAccess: HoldForCode;
  onRetried: () => void;
  onSheet: (set: SpriteSet) => void;
  set: SpriteSet;
}) {
  const sheetsId = useId();
  const [facing, setFacing] = useState<SheetFacing>(defaultFacing);
  const [takes, setTakes] = useState<SheetTakes>(3);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per sheet request: kept until it is admitted, so forging again is the same request;
  // another facing or takes is another request.
  const requestKey = useRef<string | null>(null);
  const slug = slugOf(set.character?.title);
  const ready = set.views.every((view) => view.generation.status === "done");

  async function forge() {
    requestKey.current ??= crypto.randomUUID();
    setPending(true);
    setProblem(null);

    const result = await postSpriteSheet(set.id, { facing, takes }, requestKey.current);

    setPending(false);

    if ("data" in result) {
      requestKey.current = null;
      onSheet(result.data.set);
    } else if (result.refusal.reason === "access_required") {
      onAccess("sprite-sheet", "generate", () => void forge());
    } else {
      setProblem(result.refusal.message);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-center gap-4">
          {set.character && (
            <img
              alt={set.character.title ?? "The set's character"}
              className="h-24 w-16 rounded-lg border object-cover"
              src={mediaUrl(set.character.image)}
            />
          )}
          <div className="flex flex-col gap-2">
            <Hud>Sprite Forge · seed {set.seed}</Hud>
            <h1 className="font-display text-4xl leading-none font-bold tracking-display">
              {set.character?.title ?? "Your character"}, five directions
            </h1>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link search={{ character: set.character?.id }} to="/sprites">
            New sprite set
          </Link>
        </Button>
      </div>

      <ul
        aria-label="Direction views"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
      >
        {set.views.map((view) => {
          const { direction } = view;
          const turned = direction === "sw" || direction === "w" || direction === "nw";

          return (
            <ViewCard
              facing={turned ? facing[direction] : null}
              key={`${view.generation.id}-${view.generation.status}`}
              onAccess={onAccess}
              onFacing={(next) => {
                if (turned) {
                  requestKey.current = null;
                  setFacing((current) => ({ ...current, [direction]: next }));
                }
              }}
              onRetried={onRetried}
              view={view}
            />
          );
        })}
      </ul>

      <ForgePanel
        available={set.sheets_available}
        onForge={() => void forge()}
        onTakes={(next) => {
          requestKey.current = null;
          setTakes(next);
        }}
        pending={pending}
        problem={problem}
        ready={ready}
        takes={takes}
      />

      <section aria-labelledby={sheetsId} className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-semibold" id={sheetsId}>
          Sprite sheets
        </h2>
        {set.sheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sheet forged from this set yet.</p>
        ) : (
          <ul aria-labelledby={sheetsId} className="flex flex-col gap-4">
            {set.sheets.map((sheet) => (
              <SheetCard
                key={`${sheet.generation.id}-${sheet.generation.status}`}
                onAccess={onAccess}
                onRetried={onRetried}
                sheet={sheet}
                slug={slug}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * A sprite set at `/sprites/:id`: the five direction views of its character, each following its
 * own generation (a failed one offers the shared retry; an unknown one is never retried, Comfy
 * may still be rendering it), the facing of the three turned views, the forge panel (`POST
 * /api/sprite-sets/:id/sheets` once every view is done, on a self-hosted target only) and the
 * set's sheets, most recent first, each with its downloads and the walk playground once done.
 */
export function SpriteSetPage({ spriteSetId }: { spriteSetId: string }) {
  const { page, reload, show } = useSpriteSet(spriteSetId);
  const access = useAccessCode();

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Image">
        {page.kind !== "loading" && (
          <AccessStatus
            onOpen={() => access.hold("sprite-set", "unlock", reload)}
            signedIn={page.kind !== "access"}
          />
        )}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        {page.kind === "ready" ? (
          <LoadedSet onAccess={access.hold} onRetried={reload} onSheet={show} set={page.set} />
        ) : (
          <Notice
            onAccess={() => access.hold("sprite-set", "unlock", reload)}
            onRetry={reload}
            page={page}
          />
        )}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
