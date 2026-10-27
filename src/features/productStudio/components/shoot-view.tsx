import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useReducer, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import {
  formatDetails,
  PRODUCT_SHOT_OUTPUT,
  presetDetails,
  type Shoot,
  type ShootItem,
} from "#/features/productStudio/contracts";
import { fetchShoot, retryShot } from "#/features/productStudio/studio-client";
import { Hud } from "#/shared/components/brand";
import { GeneratedImage } from "#/shared/components/generated-image";
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

/** What a shot that is not done says: its place in line, its progress, or why it stopped. */
function ShotStatus({
  generation,
  onAccess,
  onRetried,
  preset,
}: {
  generation: GenerationSnapshot;
  onAccess: () => void;
  onRetried: () => void;
  preset: ShootItem["preset"];
}) {
  const [retrying, setRetrying] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

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
    return (
      <div className="flex flex-col items-start gap-3 p-6" role="alert">
        <p className="flex items-center gap-2 font-medium text-destructive-foreground">
          <TriangleAlertIcon aria-hidden="true" className="size-4" />
          This shot failed.
        </p>
        {generation.error_message && (
          <p className="text-sm text-soft-foreground">{generation.error_message}</p>
        )}
        <Button disabled={retrying} onClick={() => void retry()} size="sm" variant="outline">
          <RotateCwIcon aria-hidden="true" />
          Try again with a new seed
        </Button>
        {refusal && <p className="text-sm text-destructive-foreground">{refusal.message}</p>}
      </div>
    );
  }

  if (generation.status === "unknown") {
    return (
      <p className="p-6 text-sm text-soft-foreground" role="status">
        Comfy may still be rendering this shot, so it is not sent again. Check its result page
        later.
      </p>
    );
  }

  const label =
    generation.status === "waiting"
      ? `Waiting in line${generation.position ? ` (${generation.position})` : ""}`
      : generation.status === "finalizing"
        ? "Saving the image"
        : "Rendering";

  return (
    <div className="flex flex-col gap-3 p-6" role="status">
      <p className="text-sm text-soft-foreground">{label}…</p>
      <Progress
        aria-label={`${presetDetails[preset].label} shot progress`}
        value={generation.status === "waiting" ? 0 : (generation.progress ?? 5)}
      />
    </div>
  );
}

/**
 * One shot of the shoot, following its generation's event stream: its progress, then its image
 * once done (AI-generated label, Download, its result page), or why it stopped.
 */
function ShotCard({
  item,
  onAccess,
  onRetried,
}: {
  item: ShootItem;
  onAccess: () => void;
  onRetried: () => void;
}) {
  const { generation } = useLiveGeneration(item.generation);
  const image = generation.outputs.find(({ name }) => name === PRODUCT_SHOT_OUTPUT);

  return (
    <li
      aria-label={`${presetDetails[item.preset].label} shot`}
      className="flex flex-col gap-3 rounded-3xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-3"
    >
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <h3 className="font-display text-lg font-semibold">{presetDetails[item.preset].label}</h3>
        {item.attempt > 0 && <Badge>Attempt {item.attempt + 1}</Badge>}
      </div>
      {generation.status === "done" && image && image.media === "image" ? (
        <>
          <GeneratedImage asset={image.asset} download />
          <Button asChild size="sm" variant="ghost">
            <Link params={{ generationId: generation.id }} to="/g/$generationId">
              <ExternalLinkIcon aria-hidden="true" />
              Result page
            </Link>
          </Button>
        </>
      ) : (
        <ShotStatus
          generation={generation}
          onAccess={onAccess}
          onRetried={onRetried}
          preset={item.preset}
        />
      )}
    </li>
  );
}

/**
 * A shoot: its product photo and settings, and one card per shot. The shots render on the server
 * whether or not this view is open; a failed one offers the shared retry (a new seed); an unknown
 * one is never retried: Comfy may still be rendering it.
 */
export function ShootView({ onAccess, shootId }: { onAccess: () => void; shootId: string }) {
  const { reload, state } = useShoot(shootId);

  if (state.kind === "loading") {
    return (
      <p className="text-muted-foreground" role="status">
        Loading the shoot…
      </p>
    );
  }

  if (state.kind === "access") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-soft-foreground">Enter the access code to see this shoot.</p>
        <Button
          onClick={() => {
            onAccess();
            reload();
          }}
          variant="outline"
        >
          Enter code
        </Button>
      </div>
    );
  }

  if (state.kind === "missing") {
    return <p className="text-soft-foreground">This shoot does not exist.</p>;
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col items-start gap-3" role="alert">
        <p className="text-destructive-foreground">{state.refusal.message}</p>
        <Button onClick={reload} variant="outline">
          Try again
        </Button>
      </div>
    );
  }

  const { shoot } = state;

  return (
    <section aria-labelledby="shoot-heading" className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <img
          alt={`Product photo: ${shoot.product.name}`}
          className="size-16 rounded-2xl border bg-white object-contain"
          src={mediaUrl(shoot.product.image)}
        />
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-semibold" id="shoot-heading">
            {shoot.product.name}
          </h2>
          <Hud>
            {formatDetails[shoot.format].label} {formatDetails[shoot.format].ratio}
            {shoot.description ? " · own scene" : ""}
          </Hud>
        </div>
      </div>
      <ul aria-label="Shots" className="grid gap-4 sm:grid-cols-2">
        {shoot.items.map((item) => (
          // Keyed by generation: a retried shot follows its new generation's stream.
          <ShotCard item={item} key={item.generation.id} onAccess={onAccess} onRetried={reload} />
        ))}
      </ul>
    </section>
  );
}
