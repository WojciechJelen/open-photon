import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  CompassIcon,
  DownloadIcon,
  FileJsonIcon,
  FilmIcon,
  HelpCircleIcon,
  HourglassIcon,
  ImageIcon,
  KeyRoundIcon,
  type LucideIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
  Share2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import {
  characterAlt,
  characterName,
  fetchBatch,
  lookLabel,
  retryGeneration,
} from "#/features/batches/batch-client";
import type { Batch, BatchItem } from "#/features/batches/contracts";
import { batchTitle } from "#/features/batches/labels";
import { batchProgress, itemState, type ItemState } from "#/features/batches/progress";
import { draftHref, parseDraft } from "#/features/motionTransfer/api";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { Hud } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import { PageHeading } from "#/shared/components/page-heading";
import { Panel } from "#/shared/components/panel";
import { ResultFigure } from "#/shared/components/result-figure";
import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";
import { SummaryRow } from "#/shared/components/summary-panel";
import { ToolColumns } from "#/shared/components/tool-layout";
import type { Asset } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";
import { dayAndTime } from "#/shared/when";

// How often the page reads the batch again while any item is still on its way. The dispatcher
// renders the items whether or not the page is open; this only keeps the view current.
const POLL_MS = 2000;

// The key the page's read waits under for the access code (`useAccessCode`).
const HELD = "batch-read";

type BatchState =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "missing" }
  | { kind: "error"; refusal: Refusal }
  | { batch: Batch; kind: "ready" };

/** Whether any item of `batch` is still waiting or running: the page reads it again then. */
function onItsWay(batch: Batch) {
  return batch.items.some((item) => {
    const state = itemState(item.generation.status);

    return state === "waiting" || state === "running";
  });
}

/**
 * `GET /api/batches/:id`, read again every `POLL_MS` while an item is on its way (or the last
 * read failed), and at once on `reload` (after a retry, or once the access code is entered). A
 * batch already shown stays when a read fails.
 */
function useBatch(id: string) {
  const [state, setState] = useState<BatchState>({ kind: "loading" });
  const [requested, reload] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const read = async () => {
      const result = await fetchBatch(id, controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      if ("data" in result) {
        setState({ batch: result.data, kind: "ready" });
      } else if (result.refusal.reason === "access_required") {
        setState({ kind: "access" });
      } else if (result.refusal.reason === "not_found") {
        setState({ kind: "missing" });
      } else {
        setState((current) =>
          current.kind === "ready" ? current : { kind: "error", refusal: result.refusal },
        );
      }

      const again =
        "data" in result
          ? onItsWay(result.data)
          : !["access_required", "not_found"].includes(result.refusal.reason ?? "");

      if (again) {
        timer = window.setTimeout(() => void read(), POLL_MS);
      }
    };

    void read();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [id, requested]);

  return { reload, state };
}

const stateLabels: Record<ItemState, string> = {
  completed: "Completed",
  failed: "Failed",
  running: "Running",
  unknown: "Unknown",
  waiting: "Waiting",
};

// The order the batch's state counts read in.
const itemStates: ItemState[] = ["completed", "running", "waiting", "failed", "unknown"];

/**
 * A batch at `/batches/:id`: its takes side by side, each with its own player, download, share
 * page, recipe and "Use this take" (its result page, `/g/:id`), and beside them the common shot
 * and the batch's progress. A take keeps its box from waiting to running, completed, failed or
 * unknown. The items render on the server whether or not this page is open; reloading it reads
 * them as they stand. A failed item offers the shared retry (a new seed); an unknown one is never
 * retried: Comfy may still be rendering it.
 */
export function BatchPage({ batchId }: { batchId: string }) {
  const { reload, state } = useBatch(batchId);
  const access = useAccessCode();
  const askForCode = useCallback(() => access.hold(HELD, "unlock", reload), [access.hold, reload]);

  return (
    <SitePage category="Video" gap={7} onAccess={askForCode} top={10}>
      {state.kind === "loading" && <BatchSkeleton />}
      {state.kind === "access" && (
        <StateCard
          heading="h1"
          icon={KeyRoundIcon}
          text="Enter the access code to see this batch."
          title="This needs an access code"
        >
          <Button onClick={askForCode} variant="outline">
            Enter code
          </Button>
        </StateCard>
      )}
      {state.kind === "missing" && (
        <StateCard
          heading="h1"
          icon={CompassIcon}
          text="This batch doesn't exist."
          title="Nothing here"
        >
          <Button asChild variant="outline">
            <Link to="/batches">All batches</Link>
          </Button>
        </StateCard>
      )}
      {state.kind === "error" && (
        <div role="alert">
          <StateCard
            icon={TriangleAlertIcon}
            text={state.refusal.message}
            title="This batch didn't load"
            tone="warning"
          >
            <Button onClick={reload} variant="outline">
              Try again
            </Button>
          </StateCard>
        </div>
      )}
      {state.kind === "ready" && (
        <BatchView batch={state.batch} onAccess={askForCode} onChange={reload} />
      )}

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}

/** The batch's page while its first read is on its way: the boxes it will fill. */
function BatchSkeleton() {
  return (
    <>
      <p className="sr-only" role="status">
        Loading the batch…
      </p>
      <div aria-hidden="true" className="contents">
        <div className="h-21 sm:h-20.5" />
        <ToolColumns aside={<Panel className="h-101.5 motion-safe:animate-pulse" />}>
          <div className="grid tiles-fill-55 gap-4">
            <div className="aspect-9/16 skeleton rounded-field" />
            <div className="aspect-9/16 skeleton rounded-field" />
            <div className="aspect-9/16 skeleton rounded-field" />
          </div>
        </ToolColumns>
      </div>
    </>
  );
}

function BatchView({
  batch,
  onAccess,
  onChange,
}: {
  batch: Batch;
  onAccess: () => void;
  onChange: () => void;
}) {
  const progress = batchProgress(batch.items.map((item) => item.generation));
  const grid = useRef<HTMLUListElement>(null);
  const [playing, setPlaying] = useState(false);

  // Starts every completed take from its beginning together, or pauses them all, to compare.
  function togglePlayback() {
    const videos = [...(grid.current?.querySelectorAll("video") ?? [])];

    for (const video of videos) {
      if (playing) {
        video.pause();
      } else {
        video.currentTime = 0;
        void video.play().catch(() => undefined);
      }
    }

    setPlaying(!playing);
  }

  return (
    <>
      <PageHeading
        actions={
          <Link
            className="-my-1.5 inline-flex h-11 w-fit items-center gap-1.5 rounded-sm type-caption font-medium text-soft-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
            to="/batches"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
            All batches
          </Link>
        }
        subtitle={<time dateTime={batch.created_at}>{dayAndTime(batch.created_at)}</time>}
        title={batchTitle(batch.kind, batch.items.length)}
      />
      <ToolColumns
        aside={
          <BatchSummary
            batch={batch}
            onTogglePlayback={togglePlayback}
            playing={playing}
            progress={progress}
          />
        }
      >
        <ul aria-label="Takes" className="grid tiles-fill-55 gap-4" ref={grid}>
          {batch.items.map((item) => (
            <TakeCard item={item} key={item.position} onAccess={onAccess} onChange={onChange} />
          ))}
        </ul>
      </ToolColumns>
    </>
  );
}

/** The panel beside the takes: how far the batch got, the shot they share, and what to do next. */
function BatchSummary({
  batch,
  onTogglePlayback,
  playing,
  progress,
}: {
  batch: Batch;
  onTogglePlayback: () => void;
  playing: boolean;
  progress: ReturnType<typeof batchProgress>;
}) {
  const { counts, finished, percent, total } = progress;
  const shot = parseDraft(batch.shot);
  // A seed batch's takes share their character, too.
  const character = batch.kind === "seeds" ? batch.items[0]?.character : null;

  return (
    <Panel className="gap-4 p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 type-caption">
          <h2 className="min-w-0 truncate font-semibold">
            {finished} of {total} finished
          </h2>
          <span className="max-w-1/2 shrink-0 truncate text-muted-foreground tabular-nums">
            {percent}%
          </span>
        </div>
        <Progress aria-label="Batch progress" value={percent} />
        <p aria-live="polite" className="sr-only" role="status">
          {itemStates.flatMap((each) =>
            counts[each] > 0 ? [`${counts[each]} ${stateLabels[each].toLowerCase()}. `] : [],
          )}
        </p>
      </div>

      <Hud tone="soft">The shot</Hud>
      <div className="flex flex-col gap-3">
        <SummaryRow
          icon={<FilmIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          label="Motion"
          media={batch.motion ? <ClipStill src={mediaUrl(batch.motion.asset)} /> : undefined}
          value={batch.motion?.title ?? "Your clip"}
        />
        <SummaryRow
          icon={<ImageIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          label="Look"
          value={lookLabel(shot)}
        />
        {character && (
          <SummaryRow
            label="Character"
            media={
              <img
                alt={characterAlt(character)}
                className="absolute inset-0 size-full object-cover"
                src={mediaUrl(character.image)}
              />
            }
            value={characterName(character)}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button disabled={counts.completed < 2} onClick={onTogglePlayback} variant="outline">
          {playing ? <PauseIcon /> : <PlayIcon />}
          {playing ? "Pause all" : "Play all"}
        </Button>
        <Button asChild variant="ghost">
          <a href={draftHref(shot)}>Open the shot</a>
        </Button>
      </div>
      {/* Its line stays when the batch finishes, so the panel keeps its height. */}
      <p
        className={cn(
          "text-center type-caption text-pretty text-muted-foreground",
          finished === total && "invisible",
        )}
      >
        You can leave while it renders.
      </p>
    </Panel>
  );
}

/** What an item varies, in words: its seed, or its character. */
function takeCaption(item: BatchItem) {
  if ("seed" in item.variation) {
    return `Seed ${item.seed ?? item.variation.seed}`;
  }

  return item.character ? characterName(item.character) : "Character";
}

/** A take's note beside its caption: a re-render after a failure, or a take that came back free. */
function takeNote(item: BatchItem) {
  if (item.attempt > 0) {
    return (
      <span
        title={
          "seed" in item.variation && item.seed !== item.variation.seed
            ? `Rendered again after a failure. Retry of seed ${item.variation.seed}.`
            : "Rendered again after a failure."
        }
      >
        Attempt {item.attempt + 1}
      </span>
    );
  }

  return item.reused && item.generation.status === "done" ? (
    <span title="Already rendered: came back free.">Reused</span>
  ) : null;
}

/**
 * A completed take's picture, at rest only that, as on a comparison board: the player's own
 * controls and the take's actions come up under the pointer or the keyboard's focus, and stay on
 * a screen that cannot hover. Cells share one portrait shape so the grid lines up: a portrait take
 * fills its cell, and a landscape one (848×480) is letterboxed instead of cropped, so every take
 * shows its whole frame.
 */
function TakePlayer({
  asset,
  caption,
  generation,
  note,
  poster,
  take,
}: {
  asset: Asset;
  caption: string;
  generation: BatchItem["generation"];
  note: ReactNode;
  poster?: Asset;
  take: number;
}) {
  // Rendered only once the batch is read, so never on the server.
  const [hovers] = useState(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  const [engaged, setEngaged] = useState(false);
  const controlled = engaged || !hovers;
  const landscape = (asset.width ?? 0) > (asset.height ?? 0);

  const follow = ({ currentTarget }: SyntheticEvent<HTMLDivElement>) =>
    setEngaged(currentTarget.matches(":hover, :focus-within"));

  return (
    <div onBlur={follow} onFocus={follow} onMouseEnter={follow} onMouseLeave={follow}>
      <ResultFigure aspect="aspect-9/16" caption={caption} meta={note}>
        <video
          aria-label={`Take ${take}`}
          className={cn(
            "absolute inset-0 size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            landscape ? "object-contain" : "object-cover",
          )}
          controls={controlled}
          loop
          muted
          playsInline
          poster={poster && mediaUrl(poster)}
          preload="metadata"
          src={mediaUrl(asset)}
          tabIndex={0}
        />
        {/* Above the player's own controls, which stay reachable under the empty part of the row. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-17 flex justify-center transition-opacity motion-reduce:transition-none",
            controlled ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="pointer-events-auto flex flex-wrap justify-center gap-1.5">
            <Button asChild size="icon" title="Download" variant="scrim">
              <a
                aria-label={`Download take ${take}`}
                download
                href={`${mediaUrl(asset)}?download=1`}
              >
                <DownloadIcon strokeWidth={1.75} />
              </a>
            </Button>
            {generation.share_slug && (
              <Button asChild size="icon" title="Share page" variant="scrim">
                <a aria-label={`Share page of take ${take}`} href={`/r/${generation.share_slug}`}>
                  <Share2Icon strokeWidth={1.75} />
                </a>
              </Button>
            )}
            <Button asChild size="icon" title="Download the recipe" variant="scrim">
              <a
                aria-label={`Recipe of take ${take}`}
                download
                href={`/api/generations/${generation.id}/recipe.json`}
              >
                <FileJsonIcon strokeWidth={1.75} />
              </a>
            </Button>
          </div>
        </div>
      </ResultFigure>
    </div>
  );
}

/**
 * The box of a take with no video to show, the size of `ResultFigure`'s, with the take's character
 * dimmed behind it: `children` say where the take stands. It carries no AI-generated tag, as it
 * shows nothing generated.
 */
function TakeState({
  caption,
  character,
  children,
  note,
}: {
  caption: string;
  character: BatchItem["character"];
  children: ReactNode;
  note: ReactNode;
}) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2.5">
      <div className="relative flex aspect-9/16 flex-col items-center justify-center gap-3 overflow-hidden rounded-field border bg-card/72 p-3 text-center">
        {character && (
          <span aria-hidden="true" className="absolute inset-0">
            <img
              alt=""
              className="absolute inset-0 size-full scale-120 object-cover blur-backdrop brightness-28"
              src={mediaUrl(character.image)}
            />
          </span>
        )}
        {children}
      </div>
      <figcaption className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="min-w-0 truncate type-label" title={caption}>
          {caption}
        </span>
        {note && (
          <span className="max-w-1/2 shrink-0 truncate type-caption text-muted-foreground">
            {note}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** A disc with an icon on a take's state, as `StateCard` has it, and the words under it. */
function TakeMessage({
  children,
  icon: Icon,
  title,
  tone,
}: {
  children?: ReactNode;
  icon: LucideIcon;
  title: string;
  tone: "quiet" | "warning";
}) {
  return (
    <div className="relative flex w-full min-w-0 flex-col items-center gap-3">
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full",
          tone === "quiet" ? "bg-foreground/10 text-foreground" : "bg-warning/14 text-warning",
        )}
      >
        <Icon aria-hidden={true} className="size-5" strokeWidth={1.75} />
      </span>
      <div className="flex w-full min-w-0 flex-col gap-1">
        <p className="type-label wrap-anywhere">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** One take of the batch: where it stands, its media once completed, and what can be done. */
function TakeCard({
  item,
  onAccess,
  onChange,
}: {
  item: BatchItem;
  onAccess: () => void;
  onChange: () => void;
}) {
  const { generation } = item;
  const state = itemState(generation.status);
  const take = item.position + 1;
  const caption = takeCaption(item);
  const video = generation.outputs.find((output) => output.name === "video");
  const poster = generation.outputs.find((output) => output.name === "poster");
  // The generation a retry was asked for: Retry stays held from the click until the batch shows
  // the attempt it admitted, so a second click cannot retry the same failure twice.
  const [retried, setRetried] = useState<string | null>(null);
  const retrying = retried === generation.id;
  const [refusal, setRefusal] = useState<string | null>(null);

  async function retry() {
    setRetried(generation.id);
    setRefusal(null);

    const result = await retryGeneration(generation.id);

    if ("data" in result) {
      onChange();

      return;
    }

    setRetried(null);

    if (result.refusal.reason === "access_required") {
      onAccess();
    } else {
      setRefusal(result.refusal.message);
    }
  }

  const error = refusal ?? generation.error_message ?? "This take failed.";
  const note = takeNote(item);

  return (
    <li
      aria-label={`Take ${take}: ${stateLabels[state]}`}
      className="flex min-w-0 flex-col gap-2.5"
    >
      {state === "completed" && video && video.media !== "text" ? (
        <>
          <TakePlayer
            asset={video.asset}
            caption={caption}
            generation={generation}
            note={note}
            poster={poster && poster.media !== "text" ? poster.asset : undefined}
            take={take}
          />
          <TakeAction>
            <Button asChild variant="outline">
              <Link params={{ generationId: generation.id }} to="/g/$generationId">
                Use this take
              </Link>
            </Button>
          </TakeAction>
        </>
      ) : (
        <>
          <TakeState caption={caption} character={item.character} note={note}>
            {state === "waiting" && (
              <TakeMessage
                icon={HourglassIcon}
                title={generation.position ? ordinal(generation.position) : "In line"}
                tone="quiet"
              />
            )}
            {state === "running" && (
              <div className="relative flex w-3/4 flex-col gap-3">
                <p className="type-label">{runningLabel(generation)}</p>
                <Progress aria-label={`Take ${take} progress`} value={generation.progress ?? 0} />
              </div>
            )}
            {state === "failed" && (
              <TakeMessage icon={TriangleAlertIcon} title="This take didn't finish" tone="warning">
                <p
                  className="line-clamp-6 type-caption wrap-anywhere text-soft-foreground"
                  role={refusal ? "alert" : undefined}
                  title={error}
                >
                  {error}
                </p>
              </TakeMessage>
            )}
            {state === "unknown" && (
              <TakeMessage icon={HelpCircleIcon} title="Result unknown" tone="warning">
                <p className="line-clamp-8 type-caption text-soft-foreground">
                  Comfy may have accepted this take before its job was saved, so it is never sent
                  again on its own. Check the rendering backend before rendering it anew.
                </p>
              </TakeMessage>
            )}
          </TakeState>
          <TakeAction>
            {state === "failed" ? (
              <Button
                aria-label={`Retry take ${take}`}
                disabled={retrying}
                onClick={() => void retry()}
                variant="outline"
              >
                <RotateCwIcon />
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            ) : state === "waiting" || state === "running" ? (
              <Button disabled variant="outline">
                Use this take
              </Button>
            ) : (
              <Button asChild variant="ghost">
                <Link params={{ generationId: generation.id }} to="/g/$generationId">
                  Details
                </Link>
              </Button>
            )}
          </TakeAction>
        </>
      )}
    </li>
  );
}

/** A take's one action, full width, on the same line in every state. */
function TakeAction({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-col">{children}</div>;
}

/** 1st, 2nd, 3rd, 4th… for a place in line. */
function ordinal(place: number) {
  const suffix =
    place % 100 >= 11 && place % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][place % 10] ?? "th");

  return `${place}${suffix} in line`;
}

/** What a running take is doing, in words. */
function runningLabel({ progress, status }: BatchItem["generation"]) {
  if (status === "preparing") {
    return "Starting…";
  }

  if (status === "finalizing") {
    return "Saving…";
  }

  return progress === null ? "Queued on Comfy" : `Rendering ${progress}%`;
}
