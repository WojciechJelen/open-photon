import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowRightIcon, KeyRoundIcon, LayersIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { fetchBatches } from "#/features/batches/batch-client";
import type { BatchList } from "#/features/batches/contracts";
import { batchTitle } from "#/features/batches/labels";
import { batchProgress } from "#/features/batches/progress";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { StatusDot } from "#/shared/components/brand";
import { PageHeading } from "#/shared/components/page-heading";
import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";
import { dayAndTime } from "#/shared/when";

type ListState =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "error"; refusal: Refusal }
  | { kind: "ready"; list: BatchList };

type ListedBatch = BatchList["batches"][number];

// The most boxes a row's strip holds: a longer batch counts the rest on the last one, so its
// thumbnails never push the row apart.
const STRIP_BOXES = 4;

// One thumbnail's box, 48×76, before its picture loads.
const box = "relative block h-19 w-12 shrink-0 overflow-hidden rounded-sm bg-screen";

/**
 * `/batches`: the workspace's batches, most recent first, each with its takes' pictures, how far
 * it got and a link to its page. One workspace per installation: everyone with an access code
 * here sees the same ones.
 */
export function BatchHistory() {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  const nextSignal = useRequestSignal();
  const access = useAccessCode();
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  const askForCode = useCallback(
    () => access.hold("batches", "unlock", reload),
    [access.hold, reload],
  );

  useEffect(() => {
    const signal = nextSignal();

    void fetchBatches(signal).then((result) => {
      if (signal.aborted) {
        return;
      }

      setState(
        "data" in result
          ? { kind: "ready", list: result.data }
          : result.refusal.reason === "access_required"
            ? { kind: "access" }
            : { kind: "error", refusal: result.refusal },
      );
    });
  }, [nextSignal, version]);

  const empty = state.kind === "ready" && state.list.batches.length === 0;

  return (
    <SitePage category="Video" gap={7} onAccess={askForCode} top={10}>
      <PageHeading
        actions={!empty && <SetUpShot />}
        subtitle="Compare several takes of one shot."
        title="Batches"
      />

      {state.kind === "loading" && (
        <>
          <p className="sr-only" role="status">
            Loading batches…
          </p>
          <div aria-hidden="true" className="flex flex-col gap-2.5">
            <div className="h-49 rounded-menu border bg-card/72 sm:h-25.5" />
            <div className="h-49 rounded-menu border bg-card/72 sm:h-25.5" />
          </div>
        </>
      )}
      {state.kind === "access" && (
        <StateCard
          icon={KeyRoundIcon}
          text="Enter the access code to see the batches."
          title="This needs an access code"
        >
          <Button onClick={askForCode} variant="outline">
            Enter code
          </Button>
        </StateCard>
      )}
      {state.kind === "error" && (
        <div role="alert">
          <StateCard
            icon={TriangleAlertIcon}
            text={state.refusal.message}
            title="The batches didn't load"
            tone="warning"
          >
            <Button onClick={reload} variant="outline">
              Try again
            </Button>
          </StateCard>
        </div>
      )}
      {empty && (
        <StateCard
          icon={LayersIcon}
          text="Render variations from any shot, then compare them here."
          title="No batches yet"
        >
          <SetUpShot />
        </StateCard>
      )}
      {state.kind === "ready" && !empty && (
        <ul className="flex flex-col gap-2.5">
          {state.list.batches.map((batch) => (
            <BatchRow batch={batch} key={batch.id} />
          ))}
        </ul>
      )}

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}

/** Where a batch starts: the wizard, whose Direct step offers Variations. */
function SetUpShot() {
  return (
    <Button asChild variant="outline">
      <Link search={{}} to="/motionTransfer">
        Set up a shot
      </Link>
    </Button>
  );
}

/** One batch of the list: its takes' pictures, what it is, when, and how far it got. */
function BatchRow({ batch }: { batch: ListedBatch }) {
  const title = batchTitle(batch.kind, batch.statuses.length);
  const time = dayAndTime(batch.created_at);

  return (
    <li>
      <Link
        className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-menu border bg-card/72 py-3 pr-5 pl-3 transition-colors outline-none hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
        params={{ batchId: batch.id }}
        to="/batches/$batchId"
      >
        <TakeStrip rendered={batch.statuses.includes("done")} thumbnails={batch.thumbnails} />
        <span className="flex min-w-0 flex-1 basis-55 flex-col">
          <span className="truncate text-base font-semibold text-foreground" title={title}>
            {title}
          </span>
          <time className="truncate text-sm text-muted-foreground" dateTime={batch.created_at}>
            {time}
          </time>
        </span>
        <BatchStatus statuses={batch.statuses} />
        <ArrowRightIcon
          aria-hidden="true"
          className="ml-auto size-4 shrink-0 text-soft-foreground"
          strokeWidth={1.75}
        />
      </Link>
    </li>
  );
}

/**
 * A batch's takes in small: at most `STRIP_BOXES` boxes, the last one counting the takes that do
 * not fit. Each take that has no picture keeps its empty box. Once one is `rendered`, one tag
 * says the strip shows AI-generated takes: a thumbnail is too narrow for its own.
 */
function TakeStrip({
  rendered,
  thumbnails,
}: {
  rendered: boolean;
  thumbnails: ListedBatch["thumbnails"];
}) {
  const fits = thumbnails.length <= STRIP_BOXES;
  const shown = fits ? thumbnails : thumbnails.slice(0, STRIP_BOXES - 1);

  return (
    <span className="relative flex shrink-0">
      <span aria-hidden="true" className="flex gap-0.75">
        {shown.map((thumbnail, index) => (
          <span className={box} key={index}>
            {thumbnail && (
              <img
                alt=""
                className="absolute inset-0 size-full object-cover"
                loading="lazy"
                src={mediaUrl(thumbnail)}
              />
            )}
          </span>
        ))}
        {!fits && (
          <span
            className={cn(
              box,
              "grid place-items-center bg-foreground/6 type-readout text-soft-foreground",
            )}
          >
            +{thumbnails.length - shown.length}
          </span>
        )}
      </span>
      {rendered && (
        <span className="absolute bottom-1 left-1 rounded-tag bg-background/66 px-1 py-0.75 type-tag whitespace-nowrap text-foreground">
          AI-generated
        </span>
      )}
    </span>
  );
}

/** How far a batch got, in one pill that says when takes failed or are unaccounted for. */
function BatchStatus({ statuses }: { statuses: ListedBatch["statuses"] }) {
  const { counts, finished, total } = batchProgress(
    statuses.map((status) => ({ progress: null, status })),
  );

  const onItsWay = finished < total;

  const variant =
    counts.failed > 0
      ? "destructive"
      : counts.unknown > 0
        ? "warning"
        : onItsWay
          ? "brand"
          : "default";

  return (
    <Badge variant={variant}>
      {onItsWay && <StatusDot tone="brand" />}
      {counts.completed} of {total} done
      {counts.failed > 0 && ` · ${counts.failed} failed`}
      {counts.unknown > 0 && ` · ${counts.unknown} unknown`}
    </Badge>
  );
}
