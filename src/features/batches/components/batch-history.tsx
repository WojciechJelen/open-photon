import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { fetchBatches } from "#/features/batches/batch-client";
import type { BatchList } from "#/features/batches/contracts";
import { batchProgress } from "#/features/batches/progress";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

type ListState =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "error"; refusal: Refusal }
  | { kind: "ready"; list: BatchList };

/**
 * `/batches`: the workspace's batches, most recent first, each with how far it got, linking to
 * its page. One workspace per installation: everyone with an access code here sees the same ones.
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

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Video">
        {state.kind !== "loading" && (
          <AccessStatus onOpen={askForCode} signedIn={state.kind !== "access"} />
        )}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex flex-col gap-4">
          <Hud>Motion Transfer</Hud>
          <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
            Batches
          </h1>
          <p className="max-w-2xl text-soft-foreground">
            Variations of one shot, rendered in line on the server. Start one from Motion Transfer's
            Direct step, or from a finished take, with Variations.
          </p>
        </div>

        {state.kind === "loading" && (
          <p className="text-muted-foreground" role="status">
            Loading batches…
          </p>
        )}
        {state.kind === "access" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-soft-foreground">Enter the access code to see the batches.</p>
            <Button onClick={askForCode} variant="outline">
              Enter code
            </Button>
          </div>
        )}
        {state.kind === "error" && (
          <p className="text-destructive-foreground" role="alert">
            {state.refusal.message}
          </p>
        )}
        {state.kind === "ready" && state.list.batches.length === 0 && (
          <p className="text-soft-foreground">
            No batches yet.{" "}
            <Link className="underline underline-offset-3" search={{}} to="/motionTransfer">
              Set up a shot
            </Link>{" "}
            and choose Variations.
          </p>
        )}
        {state.kind === "ready" && state.list.batches.length > 0 && (
          <ul className="flex flex-col gap-3">
            {state.list.batches.map((batch) => {
              const progress = batchProgress(
                batch.statuses.map((status) => ({ progress: null, status })),
              );

              return (
                <li key={batch.id}>
                  <Link
                    className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-4 outline-none hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    params={{ batchId: batch.id }}
                    to="/batches/$batchId"
                  >
                    <span className="font-medium">
                      {batch.statuses.length}{" "}
                      {batch.kind === "seeds" ? "seed variations" : "characters, one shot"}
                    </span>
                    <time className="text-sm text-muted-foreground" dateTime={batch.created_at}>
                      {new Date(batch.created_at).toLocaleString()}
                    </time>
                    <span className="flex flex-wrap gap-2">
                      <Badge variant="brand">{progress.counts.completed} completed</Badge>
                      {progress.counts.failed > 0 && (
                        <Badge variant="destructive">{progress.counts.failed} failed</Badge>
                      )}
                      {progress.counts.unknown > 0 && (
                        <Badge variant="warning">{progress.counts.unknown} unknown</Badge>
                      )}
                      {progress.total - progress.finished > 0 && (
                        <Badge>{progress.total - progress.finished} on the way</Badge>
                      )}
                    </span>
                    <ArrowRightIcon aria-hidden="true" className="ml-auto size-4" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
