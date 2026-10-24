import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  ClockIcon,
  DownloadIcon,
  FileJsonIcon,
  HelpCircleIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
  Share2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import {
  characterAlt,
  characterName,
  fetchBatch,
  lookLabel,
  retryGeneration,
  seedLabel,
} from "#/features/batches/batch-client";
import type { Batch, BatchItem } from "#/features/batches/contracts";
import { batchProgress, itemState, type ItemState } from "#/features/batches/progress";
import { draftHref, parseDraft } from "#/features/motionTransfer/api";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";

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

const stateBadges: Record<ItemState, "brand" | "default" | "destructive" | "warning"> = {
  completed: "brand",
  failed: "destructive",
  running: "default",
  unknown: "warning",
  waiting: "default",
};

/** The batch's heading: what it varies, and how many. */
function titleOf(batch: Batch) {
  return batch.kind === "seeds"
    ? `${batch.items.length} seed variations`
    : `${batch.items.length} characters, one shot`;
}

/**
 * A batch at `/batches/:id`: its common shot, its items' states (waiting, running, completed,
 * failed, unknown) with the batch's aggregate progress, and the comparison grid of its takes,
 * each with its own player, download, share page, recipe and "Use this take" (its result page,
 * `/g/:id`). The items render on the server whether or not this page is open; reloading it reads
 * them as they stand. A failed item offers the shared retry (a new seed); an unknown one is never
 * retried: Comfy may still be rendering it.
 */
export function BatchPage({ batchId }: { batchId: string }) {
  const { reload, state } = useBatch(batchId);
  const access = useAccessCode();
  const askForCode = useCallback(() => access.hold(HELD, "unlock", reload), [access.hold, reload]);

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Video">
        {state.kind !== "loading" && (
          <AccessStatus onOpen={askForCode} signedIn={state.kind !== "access"} />
        )}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        {state.kind === "loading" && (
          <p className="text-muted-foreground" role="status">
            Loading the batch…
          </p>
        )}
        {state.kind === "access" && (
          <section className="flex flex-col items-start gap-4">
            <h1 className="font-display text-4xl leading-none font-bold tracking-display">Batch</h1>
            <p className="text-soft-foreground">Enter the access code to see this batch.</p>
            <Button onClick={askForCode} variant="outline">
              Enter code
            </Button>
          </section>
        )}
        {state.kind === "missing" && (
          <section className="flex flex-col items-start gap-4">
            <h1 className="font-display text-4xl leading-none font-bold tracking-display">
              Batch not found
            </h1>
            <Link className="underline underline-offset-3" to="/batches">
              All batches
            </Link>
          </section>
        )}
        {state.kind === "error" && (
          <section className="flex flex-col items-start gap-4" role="alert">
            <p className="text-destructive-foreground">{state.refusal.message}</p>
            <Button onClick={reload} variant="outline">
              Try again
            </Button>
          </section>
        )}
        {state.kind === "ready" && (
          <BatchView batch={state.batch} onAccess={askForCode} onChange={reload} />
        )}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
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
  const { counts } = progress;

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

  const created = new Date(batch.created_at);
  const shot = parseDraft(batch.shot);

  return (
    <>
      <div className="flex flex-col gap-4">
        <Hud>Batch</Hud>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
            {titleOf(batch)}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={draftHref(shot)}>Open the shot</a>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/batches">All batches</Link>
            </Button>
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Started</dt>
            <dd className="text-soft-foreground">
              <time dateTime={batch.created_at}>{created.toLocaleString()}</time>
            </dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="text-muted-foreground">Look</dt>
            <dd className="line-clamp-1 text-soft-foreground">{lookLabel(shot)}</dd>
          </div>
          {batch.kind === "characters" && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Seed</dt>
              <dd className="text-soft-foreground">{seedLabel(shot)}</dd>
            </div>
          )}
        </dl>
      </div>

      <section
        aria-labelledby="batch-progress"
        className="flex flex-col gap-3 rounded-2xl border p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium" id="batch-progress">
            {progress.finished} of {progress.total} finished
          </h2>
          <p aria-live="polite" className="flex flex-wrap gap-2 text-sm" role="status">
            {itemStates.flatMap((each) =>
              counts[each] > 0
                ? [
                    <Badge key={each} variant={stateBadges[each]}>
                      {counts[each]} {stateLabels[each].toLowerCase()}
                    </Badge>,
                  ]
                : [],
            )}
          </p>
        </div>
        <Progress aria-label="Batch progress" value={progress.percent} />
        <p className="text-sm text-muted-foreground">
          {progress.finished === progress.total
            ? "Every take has finished."
            : "The takes render in line on the server. You can close this page: they keep rendering, and this page shows them when you come back."}
        </p>
      </section>

      <section aria-labelledby="batch-takes" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium" id="batch-takes">
            Compare takes
          </h2>
          {counts.completed > 1 && (
            <Button onClick={togglePlayback} size="sm" variant="outline">
              {playing ? <PauseIcon /> : <PlayIcon />}
              {playing ? "Pause all" : "Play all"}
            </Button>
          )}
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" ref={grid}>
          {batch.items.map((item) => (
            <TakeCard item={item} key={item.position} onAccess={onAccess} onChange={onChange} />
          ))}
        </ul>
      </section>
    </>
  );
}

/** What an item varies, in words: its seed (and the seed a retry rendered with), or its character. */
function VariationLabel({ item }: { item: BatchItem }) {
  if ("seed" in item.variation) {
    return (
      <span className="tabular-nums">
        Seed {item.seed ?? item.variation.seed}
        {item.seed !== item.variation.seed && (
          <span className="text-muted-foreground"> (retry of {item.variation.seed})</span>
        )}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      {item.character && (
        <img
          alt={characterAlt(item.character)}
          className="size-6 shrink-0 rounded-full object-cover"
          src={mediaUrl(item.character.image)}
        />
      )}
      <span className="truncate">
        {item.character ? characterName(item.character) : "Character"}
      </span>
    </span>
  );
}

/** One take of the batch: its state, its media once completed, and what can be done with it. */
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

  return (
    <li
      aria-label={`Take ${take}: ${stateLabels[state]}`}
      className="flex min-w-0 flex-col gap-2.5 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-2.5 sm:p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Take {take}</span>
        <Badge variant={stateBadges[state]}>{stateLabels[state]}</Badge>
      </div>
      <div className="min-w-0 text-sm text-soft-foreground">
        <VariationLabel item={item} />
      </div>

      {/* Cells share one portrait shape so the grid lines up; `object-contain` letterboxes a
          landscape take (848×480) instead of cropping it, so every take shows its whole frame. */}
      <div className="relative aspect-9/16 overflow-hidden rounded-xl bg-foreground/5">
        {state === "completed" && video && video.media !== "text" ? (
          <video
            aria-label={`Take ${take}`}
            className="absolute inset-0 size-full bg-black object-contain"
            controls
            loop
            muted
            playsInline
            poster={poster && poster.media !== "text" ? mediaUrl(poster.asset) : undefined}
            preload="metadata"
            src={mediaUrl(video.asset)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-3 text-center text-sm">
            {state === "waiting" && (
              <>
                <ClockIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                <span>{generation.position ? ordinal(generation.position) : "In line"}</span>
              </>
            )}
            {state === "running" && (
              <>
                <span>{runningLabel(generation)}</span>
                <div className="w-3/4">
                  <Progress aria-label={`Take ${take} progress`} value={generation.progress ?? 0} />
                </div>
              </>
            )}
            {state === "failed" && (
              <>
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="size-5 text-destructive-foreground"
                />
                <span className="line-clamp-6 text-soft-foreground">
                  {generation.error_message ?? "This take failed."}
                </span>
              </>
            )}
            {state === "unknown" && (
              <>
                <HelpCircleIcon aria-hidden="true" className="size-5 text-warning-foreground" />
                <span className="line-clamp-8 text-soft-foreground">
                  Comfy may have accepted this take before its job was saved, so it is never sent
                  again on its own. Check the rendering backend before rendering it anew.
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {item.reused && state === "completed" && (
        <p className="text-xs text-muted-foreground">Already rendered: came back free.</p>
      )}
      {item.attempt > 0 && (
        <p className="text-xs text-muted-foreground">
          Attempt {item.attempt + 1}: rendered again after a failure.
        </p>
      )}

      {state === "completed" && video && video.media !== "text" && (
        <div className="mt-auto flex flex-col gap-2">
          <Button asChild size="sm">
            <Link params={{ generationId: generation.id }} to="/g/$generationId">
              Use this take
              <ArrowRightIcon />
            </Link>
          </Button>
          <div className="flex flex-wrap justify-center gap-1">
            <Button asChild size="icon" title="Download MP4" variant="ghost">
              <a
                aria-label={`Download take ${take}`}
                download
                href={`${mediaUrl(video.asset)}?download=1`}
              >
                <DownloadIcon />
              </a>
            </Button>
            {generation.share_slug && (
              <Button asChild size="icon" title="Share page" variant="ghost">
                <a aria-label={`Share page of take ${take}`} href={`/r/${generation.share_slug}`}>
                  <Share2Icon />
                </a>
              </Button>
            )}
            <Button asChild size="icon" title="Recipe JSON" variant="ghost">
              <a
                aria-label={`Recipe of take ${take}`}
                href={`/api/generations/${generation.id}/recipe.json`}
              >
                <FileJsonIcon />
              </a>
            </Button>
          </div>
        </div>
      )}

      {state === "failed" && (
        <div className="mt-auto flex flex-col gap-2">
          <Button
            aria-label={`Retry take ${take}`}
            disabled={retrying}
            onClick={() => void retry()}
            size="sm"
            variant="outline"
          >
            <RotateCwIcon />
            {retrying ? "Retrying…" : "Retry"}
          </Button>
          {refusal && (
            <p className="text-xs text-destructive-foreground" role="alert">
              {refusal}
            </p>
          )}
        </div>
      )}

      {state === "unknown" && (
        <div className="mt-auto grid">
          <Button asChild size="sm" variant="ghost">
            <Link params={{ generationId: generation.id }} to="/g/$generationId">
              Details
            </Link>
          </Button>
        </div>
      )}
    </li>
  );
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
