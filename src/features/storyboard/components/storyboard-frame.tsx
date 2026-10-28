import { Link } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";

// How often a page reads again while something it shows is on its way. The dispatcher renders
// whether or not the page is open; reading again only keeps the view current.
const POLL_MS = 2000;

type Read<T> = (signal: AbortSignal) => Promise<{ data: T } | { refusal: Refusal }>;

/** What a storyboard page shows: its value once read, or why it cannot. */
export type Loaded<T> =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "missing" }
  | { kind: "error"; refusal: Refusal }
  | { kind: "ready"; value: T };

function settle<T>(previous: Loaded<T>, result: { data: T } | { refusal: Refusal }): Loaded<T> {
  if ("data" in result) {
    return { kind: "ready", value: result.data };
  }

  switch (result.refusal.reason) {
    case "access_required":
      return { kind: "access" };
    case "not_found":
      return { kind: "missing" };
    default:
      // A value already shown stays when a later read fails.
      return previous.kind === "ready" ? previous : { kind: "error", refusal: result.refusal };
  }
}

/**
 * Reads with `read` when the page opens and on `reload`, and again every `POLL_MS` while
 * `again(value)` holds or the last read failed for a reason other than access or a missing page.
 * `show` puts a value a write answered with on the page at once.
 */
export function useStoryboardRead<T>(read: Read<T>, again: (value: T) => boolean) {
  const [state, setState] = useState<Loaded<T>>({ kind: "loading" });
  const [requested, setRequested] = useState(0);
  const reload = useCallback(() => setRequested((count) => count + 1), []);

  useEffect(() => {
    let timer: number | undefined;
    const controller = new AbortController();

    async function next() {
      const result = await read(controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      setState((previous) => settle(previous, result));

      const final =
        "data" in result
          ? !again(result.data)
          : result.refusal.reason === "access_required" || result.refusal.reason === "not_found";

      if (!final) {
        timer = window.setTimeout(() => void next(), POLL_MS);
      }
    }

    void next();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // `read` and `again` are the page's own functions of what `requested` reloads.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const show = useCallback((value: T) => setState({ kind: "ready", value }), []);

  return { reload, show, state };
}

/**
 * A storyboard page's frame: the header with the access status, the access-code dialog, and,
 * until `state` is ready, what stands in for the page (loading, the code, not found, an error
 * with Try again). `children` gets the value and the action that asks for the code.
 */
export function StoryboardFrame<T>({
  children,
  holdKey,
  noun,
  reload,
  state,
}: {
  children: (value: T, askForCode: () => void) => ReactNode;
  holdKey: string;
  noun: string;
  reload: () => void;
  state: Loaded<T>;
}) {
  const access = useAccessCode();

  const askForCode = useCallback(
    () => access.hold(holdKey, "unlock", reload),
    [access.hold, holdKey, reload],
  );

  let body: ReactNode;

  switch (state.kind) {
    case "loading":
      body = (
        <p className="text-muted-foreground" role="status">
          Loading {noun}…
        </p>
      );
      break;
    case "access":
      body = (
        <div className="flex flex-col items-start gap-3">
          <p className="text-soft-foreground">Enter the access code to open {noun}.</p>
          <Button onClick={askForCode} variant="outline">
            Enter code
          </Button>
        </div>
      );
      break;
    case "missing":
      body = (
        <div className="flex flex-col items-start gap-3">
          <h1 className="font-display text-4xl leading-none font-bold tracking-display">
            Storyboard not found
          </h1>
          <Link className="underline underline-offset-3" to="/storyboards">
            All storyboards
          </Link>
        </div>
      );
      break;
    case "error":
      body = (
        <div className="flex flex-col items-start gap-3" role="alert">
          <p className="text-destructive-foreground">{state.refusal.message}</p>
          <Button onClick={reload} variant="outline">
            Try again
          </Button>
        </div>
      );
      break;
    case "ready":
      body = children(state.value, askForCode);
  }

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Image">
        {state.kind !== "loading" && (
          <AccessStatus onOpen={askForCode} signedIn={state.kind !== "access"} />
        )}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        {body}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
