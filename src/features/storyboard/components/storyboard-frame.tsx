import { Link } from "@tanstack/react-router";
import { CompassIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useCallback, useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";
import type { Refusal } from "#/shared/requests";
import { type HoldForCode, useAccessCode } from "#/shared/use-access-code";

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
 * `first` is what the page shows until the first read; without it, it is loading. `show` puts a
 * value a write answered with on the page at once.
 */
export function useStoryboardRead<T>(read: Read<T>, again: (value: T) => boolean, first?: T) {
  const [state, setState] = useState<Loaded<T>>(
    first === undefined ? { kind: "loading" } : { kind: "ready", value: first },
  );

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
 * A storyboard page's frame: the site around it, the access-code dialog, and, until `state` is
 * ready, what stands in for the page (`loading`, the page's boxes with nothing in them yet; the
 * code; not found; an error with Try again). `children` gets the value, the action that asks for
 * the code and what holds another action for it; `gap` and `top` are the page's own spacing.
 */
export function StoryboardFrame<T>({
  children,
  gap,
  holdKey,
  loading,
  noun,
  reload,
  state,
  top,
}: {
  children: (
    value: T,
    askForCode: () => void,
    held: { hold: HoldForCode; release: (key: string) => void },
  ) => ReactNode;
  gap: ComponentProps<typeof SitePage>["gap"];
  holdKey: string;
  loading?: ReactNode;
  noun: string;
  reload: () => void;
  state: Loaded<T>;
  top: ComponentProps<typeof SitePage>["top"];
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
        <>
          <p className="sr-only" role="status">
            Loading {noun}…
          </p>
          {loading}
        </>
      );
      break;
    case "access":
      body = (
        <StateCard
          heading="h1"
          icon={LockIcon}
          text={`Enter the access code to see ${noun}.`}
          title="This needs an access code"
        >
          <Button onClick={askForCode} variant="outline">
            Enter code
          </Button>
        </StateCard>
      );
      break;
    case "missing":
      body = (
        <StateCard
          heading="h1"
          icon={CompassIcon}
          text="This storyboard doesn't exist."
          title="Nothing here"
        >
          <Button asChild variant="outline">
            <Link to="/storyboards">All storyboards</Link>
          </Button>
        </StateCard>
      );
      break;
    case "error":
      body = (
        <div role="alert">
          <StateCard
            heading="h1"
            icon={TriangleAlertIcon}
            text={state.refusal.message}
            title="This didn't load"
            tone="warning"
          >
            <Button onClick={reload} variant="outline">
              Try again
            </Button>
          </StateCard>
        </div>
      );
      break;
    case "ready":
      body = children(state.value, askForCode, access);
  }

  return (
    <SitePage category="Image" gap={gap} onAccess={askForCode} top={top}>
      {body}

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}
