import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CompassIcon,
  DownloadIcon,
  HourglassIcon,
  LockIcon,
  MaximizeIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useReducer, useState } from "react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import {
  PRODUCT_SHOT_OUTPUT,
  presetDetails,
  type ProductShotFormat,
  type Shoot,
  type ShootItem,
} from "#/features/productStudio/contracts";
import { fetchShoot, retryShot } from "#/features/productStudio/studio-client";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { ResultFigure } from "#/shared/components/result-figure";
import { StateCard } from "#/shared/components/state-card";
import type { GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useLiveGeneration } from "#/shared/use-live-generation";

type ShootState =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "missing" }
  | { kind: "error"; refusal: Refusal }
  | { kind: "ready"; shoot: Shoot };

/** A shot's box, the same from waiting in line to its image: the shoot's format. */
const formatAspects: Record<ProductShotFormat, string> = {
  landscape: "aspect-3/2",
  portrait: "aspect-4/5",
  square: "aspect-square",
};

/**
 * `GET /api/product-shots/:id`, read when the view opens and again on `reload` (after a retry
 * made a shot's new generation, or once the access code is entered). Each shot then follows its
 * own generation's event stream (`ShotCard`), so the shoot is not read again while they render.
 */
function useShoot(id: string) {
  const [reads, reload] = useReducer((count: number) => count + 1, 0);
  const [state, setState] = useState<ShootState>({ kind: "loading" });

  useEffect(() => {
    const reading = new AbortController();

    void fetchShoot(id, reading.signal).then((result) => {
      if (reading.signal.aborted) {
        return;
      }

      if ("data" in result) {
        setState({ kind: "ready", shoot: result.data });

        return;
      }

      const { reason } = result.refusal;

      setState(
        reason === "not_found"
          ? { kind: "missing" }
          : reason === "access_required"
            ? { kind: "access" }
            : { kind: "error", refusal: result.refusal },
      );
    });

    return () => reading.abort();
  }, [id, reads]);

  return { reload, state };
}

/** What a shot still rendering says: its place in line, or the step it is on. */
function workingCopy({ position, status }: GenerationSnapshot) {
  switch (status) {
    case "waiting":
      return {
        text: position
          ? `Number ${position} in line. It starts by itself.`
          : "It starts by itself, so you can leave.",
        title: "In line",
      };
    case "preparing":
      return { text: "Sending the photo to Comfy.", title: "Getting ready" };
    case "queued":
      return { text: "Waiting for a free GPU.", title: "Getting ready" };
    case "finalizing":
      return { text: "Saving the image.", title: "Finishing" };
    default:
      return { text: "It keeps going if you leave.", title: "Rendering" };
  }
}

/**
 * The box of a shot that is not done: its place in line, its progress, or why it stopped, over the
 * product photo, blurred. A landscape box is too low to hold the icon as well.
 */
function ShotStatus({
  aspect,
  backdrop,
  generation,
  landscape,
  onAccess,
  onRetried,
  preset,
}: {
  aspect: string;
  backdrop: string;
  generation: GenerationSnapshot;
  landscape: boolean;
  onAccess: () => void;
  onRetried: () => void;
  preset: ShootItem["preset"];
}) {
  const [retrying, setRetrying] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const box = cn(aspect, "min-h-0 rounded-field p-4");

  async function retry() {
    setRetrying(true);
    setRefusal(null);

    const answer = await retryShot(generation.id);

    setRetrying(false);

    if ("data" in answer) {
      onRetried();
    } else if (answer.refusal.reason === "access_required") {
      onAccess();
    } else {
      setRefusal(answer.refusal);
    }
  }

  if (generation.status === "failed" || generation.status === "cancelled") {
    const reason = refusal?.message ?? generation.error_message ?? "Try again, or change the shot.";

    return (
      <div role="alert">
        <StateCard
          backdrop={backdrop}
          className={box}
          heading="h3"
          icon={landscape ? undefined : TriangleAlertIcon}
          text={
            <span className="line-clamp-2" title={reason}>
              {reason}
            </span>
          }
          title="This shot didn't finish"
          tone="warning"
        >
          <Button
            aria-label="Try again with a new seed"
            disabled={retrying}
            onClick={() => void retry()}
          >
            <RotateCwIcon aria-hidden="true" />
            Try again
          </Button>
        </StateCard>
      </div>
    );
  }

  if (generation.status === "unknown") {
    return (
      <div role="status">
        <StateCard
          backdrop={backdrop}
          className={box}
          heading="h3"
          icon={landscape ? undefined : HourglassIcon}
          text="Comfy may still be rendering this shot, so it is not sent again."
          title="Not sure yet"
          tone="quiet"
        />
      </div>
    );
  }

  const { text, title } = workingCopy(generation);

  return (
    <div role="status">
      <StateCard
        backdrop={backdrop}
        className={box}
        heading="h3"
        icon={HourglassIcon}
        text={text}
        title={title}
        tone="quiet"
      >
        <div className="w-50 max-w-full">
          <Progress
            aria-label={`${presetDetails[preset].label} shot progress`}
            value={generation.status === "waiting" ? 0 : (generation.progress ?? 5)}
          />
        </div>
      </StateCard>
    </div>
  );
}

/**
 * One shot of the shoot, following its generation's event stream: its progress, then its image
 * once done (AI-generated label, Download, its result page), or why it stopped. Every state takes
 * the same box and caption, so a shot finishing moves nothing.
 */
function ShotCard({
  backdrop,
  format,
  item,
  onAccess,
  onRetried,
}: {
  backdrop: string;
  format: ProductShotFormat;
  item: ShootItem;
  onAccess: () => void;
  onRetried: () => void;
}) {
  const { generation } = useLiveGeneration(item.generation);
  const image = generation.outputs.find(({ name }) => name === PRODUCT_SHOT_OUTPUT);
  const aspect = formatAspects[format];
  const label = presetDetails[item.preset].label;
  const attempt = item.attempt > 0 ? `Attempt ${item.attempt + 1}` : undefined;

  return (
    <li aria-label={`${label} shot`} className="min-w-0">
      {generation.status === "done" && image && image.media === "image" ? (
        <ResultFigure
          actions={
            <>
              <Button aria-label="Download" asChild size="icon" title="Download" variant="scrim">
                <a download href={`${mediaUrl(image.asset)}?download=1`}>
                  <DownloadIcon aria-hidden="true" strokeWidth={1.75} />
                </a>
              </Button>
              <Button
                aria-label="Result page"
                asChild
                size="icon"
                title="Result page"
                variant="scrim"
              >
                <Link params={{ generationId: generation.id }} to="/g/$generationId">
                  <MaximizeIcon aria-hidden="true" strokeWidth={1.75} />
                </Link>
              </Button>
            </>
          }
          aspect={aspect}
          caption={label}
          meta={attempt}
          revealActions
        >
          <img
            alt={GENERATED_IMAGE_ALT}
            className="absolute inset-0 size-full object-cover"
            src={mediaUrl(image.asset)}
          />
        </ResultFigure>
      ) : (
        <figure className="m-0 flex min-w-0 flex-col gap-2.5">
          <ShotStatus
            aspect={aspect}
            backdrop={backdrop}
            generation={generation}
            landscape={format === "landscape"}
            onAccess={onAccess}
            onRetried={onRetried}
            preset={item.preset}
          />
          <figcaption className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="min-w-0 truncate type-label">{label}</span>
            {attempt && (
              <span className="shrink-0 type-caption text-muted-foreground">{attempt}</span>
            )}
          </figcaption>
        </figure>
      )}
    </li>
  );
}

/**
 * A shoot: one box per shot and the product photo it started from. The shots render on the server
 * whether or not this view is open; a failed one offers the shared retry (a new seed); an unknown
 * one is never retried: Comfy may still be rendering it.
 */
export function ShootView({ onAccess, shootId }: { onAccess: () => void; shootId: string }) {
  const { reload, state } = useShoot(shootId);

  if (state.kind === "loading") {
    return (
      <div role="status">
        <StateCard frame title="Loading the shoot…" />
      </div>
    );
  }

  if (state.kind === "access") {
    return (
      <StateCard
        icon={LockIcon}
        text="Enter the access code to see this shoot."
        title="This needs an access code"
      >
        <Button
          onClick={() => {
            onAccess();
            reload();
          }}
          variant="outline"
        >
          Enter code
        </Button>
      </StateCard>
    );
  }

  if (state.kind === "missing") {
    return <StateCard icon={CompassIcon} text="This shoot doesn't exist." title="Nothing here" />;
  }

  if (state.kind === "error") {
    return (
      <div role="alert">
        <StateCard
          icon={TriangleAlertIcon}
          text={state.refusal.message}
          title="This shoot didn't load"
          tone="warning"
        >
          <Button onClick={reload} variant="outline">
            Try again
          </Button>
        </StateCard>
      </div>
    );
  }

  const { shoot } = state;
  const product = mediaUrl(shoot.product.image);

  return (
    <section aria-labelledby="shoot-heading">
      <h2 className="sr-only" id="shoot-heading">
        {shoot.product.name}
      </h2>
      <ul
        aria-label="Shots"
        className={cn("grid gap-4", shoot.format === "landscape" ? "grid-fit-80" : "grid-fit-65")}
      >
        {shoot.items.map((item) => (
          // Keyed by generation: a retried shot follows its new generation's stream.
          <ShotCard
            backdrop={product}
            format={shoot.format}
            item={item}
            key={item.generation.id}
            onAccess={onAccess}
            onRetried={reload}
          />
        ))}
        <li className="min-w-0">
          <figure className="m-0 flex min-w-0 flex-col gap-2.5">
            <div
              className={cn(
                "relative overflow-hidden rounded-field border bg-screen",
                formatAspects[shoot.format],
              )}
            >
              {/* A landscape box would cut a product down to its middle. */}
              <img
                alt={`Product photo: ${shoot.product.name}`}
                className={cn(
                  "absolute inset-0 size-full",
                  shoot.format === "landscape" ? "object-contain" : "object-cover",
                )}
                src={product}
              />
            </div>
            <figcaption className="min-w-0 truncate type-label">Your photo</figcaption>
          </figure>
        </li>
      </ul>
    </section>
  );
}
