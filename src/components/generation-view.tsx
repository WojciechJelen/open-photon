import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { ComparePlayer } from "#/components/compare-player";
import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { type Asset, generationEventSchema, type GenerationSnapshot } from "#/lib/contracts";
import { mediaUrl } from "#/lib/media";
import { callApi } from "#/lib/requests";
import { useRequestSignal } from "#/lib/use-request-signal";

const finished = new Set(["done", "failed", "unknown"]);

/** The generation as its event stream reports it, until it is done, failed or unknown. */
function useLiveGeneration(initial: GenerationSnapshot) {
  const [generation, setGeneration] = useState(initial);

  useEffect(() => {
    if (finished.has(initial.status)) {
      return;
    }

    const events = new EventSource(`/api/generations/${initial.id}/events`);

    events.addEventListener("message", (event) => {
      const snapshot = generationEventSchema.parse(JSON.parse(z.string().parse(event.data)));

      setGeneration(snapshot.generation);

      // The server ends the stream after a final snapshot; closing stops EventSource reconnecting.
      if (finished.has(snapshot.generation.status)) {
        events.close();
      }
    });

    return () => events.close();
  }, [initial.id, initial.status]);

  return generation;
}

/**
 * One generation: its status word and percent while it runs (never a time estimate, which
 * Comfy does not give), the result next to its source clip when done, the reason and Retry when
 * failed, and why an `unknown` one is not retried.
 */
export function GenerationView({
  initial,
  source,
}: {
  initial: GenerationSnapshot;
  source: Asset;
}) {
  const generation = useLiveGeneration(initial);
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const nextSignal = useRequestSignal();
  const percent = generation.progress ?? 0;
  const running = !finished.has(generation.status);

  const result =
    generation.status === "done" && generation.final_asset_id
      ? mediaUrl({ id: generation.final_asset_id, mime: "video/mp4" })
      : null;

  async function retry() {
    // Not passed to the request: a retry that reached the server finishes there. Leaving the page
    // only drops the navigation to the child.
    const signal = nextSignal();

    setRetrying(true);
    setRetryError(null);

    const result = await callApi(
      z.object({ id: z.uuid() }),
      `/api/generations/${generation.id}/retry`,
      { method: "POST" },
    );

    if (signal.aborted) {
      return;
    }

    if ("refusal" in result) {
      setRetryError(result.refusal.message);
      setRetrying(false);
    } else {
      await navigate({ params: { generationId: result.data.id }, to: "/g/$generationId" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p
        aria-label="Generation status"
        className="text-lg"
        data-status={generation.status}
        role="status"
      >
        {running ? `${generation.status} · ${percent}%` : generation.status}
      </p>
      {running && <Progress aria-label="Progress" value={percent} />}
      {generation.parent_id && (
        <p className="text-sm">
          A retry of{" "}
          <Link
            className="underline"
            params={{ generationId: generation.parent_id }}
            to="/g/$generationId"
          >
            the earlier generation
          </Link>
          , with a new seed.
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          <ComparePlayer
            // `generate` renders a portrait clip as 480×848 and any other as 848×480.
            portrait={(source.height ?? 0) >= (source.width ?? 0)}
            poster={
              generation.poster_asset_id
                ? mediaUrl({ id: generation.poster_asset_id, mime: "image/jpeg" })
                : undefined
            }
            result={result}
            source={mediaUrl(source)}
          />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a download href={`${result}?download=1`}>
                Download MP4
              </a>
            </Button>
            {/* A remix opens `/` with one choice kept and the other left to make. */}
            <Button asChild variant="outline">
              <Link search={{ motion: source.id }} to="/">
                Same motion, another character
              </Link>
            </Button>
            {generation.character_id && (
              <Button asChild variant="outline">
                <Link search={{ character: generation.character_id }} to="/">
                  Same character, another motion
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}

      {generation.status === "failed" && (
        <div className="flex flex-col gap-3">
          <p role="alert">{generation.error_message ?? "The generation failed."}</p>
          {retryError && (
            <p className="text-sm text-destructive" role="alert">
              {retryError}
            </p>
          )}
          <div>
            <Button disabled={retrying} onClick={retry}>
              {retrying ? "Retrying…" : "Retry with a new seed"}
            </Button>
          </div>
        </div>
      )}

      {generation.status === "unknown" && (
        <p role="alert">
          {generation.error_message ??
            "Comfy may have accepted this generation, so it is not submitted again."}{" "}
          Start a new generation instead.
        </p>
      )}

      <div className="flex flex-wrap gap-4">
        {/* After a failure the choices may be what to change: back to them, both still picked. */}
        {(generation.status === "failed" || generation.status === "unknown") && (
          <Link
            className="text-sm underline"
            search={{ motion: source.id, character: generation.character_id ?? undefined }}
            to="/"
          >
            Change the motion or character
          </Link>
        )}
        <Link className="text-sm underline" to="/">
          Start a new generation
        </Link>
      </div>
    </div>
  );
}
