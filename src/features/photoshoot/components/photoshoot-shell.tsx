import { Link } from "@tanstack/react-router";
import { CompassIcon, KeyRoundIcon, TriangleAlertIcon } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "#/components/ui/button";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

/**
 * What a photoshoot page has read: nothing yet, a refusal for the code, a record that is not there,
 * another refusal, or `T`.
 */
export type Loaded<T> =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "missing" }
  | { kind: "error"; refusal: Refusal }
  | ({ kind: "ready" } & T);

/**
 * The frame of both photoshoot pages: the header with the access status, the access, missing and
 * error states of what the page reads, and the page's access-code dialog. `children` draw the rest,
 * loading included (their own boxes, empty); `SitePage`'s `top` and `gap` follow each page's board.
 */
export function PhotoshootShell({
  access,
  askForCode,
  children,
  gap,
  locked,
  loaded,
  top,
  waiting,
}: {
  access: ReturnType<typeof useAccessCode>;
  askForCode: () => void;
  children: ReactNode;
  gap: ComponentProps<typeof SitePage>["gap"];
  locked: string;
  loaded: Loaded<object>;
  top: ComponentProps<typeof SitePage>["top"];
  waiting: string;
}) {
  return (
    <SitePage category="Image" gap={gap} onAccess={askForCode} top={top}>
      {children}
      {loaded.kind === "loading" && (
        <p className="sr-only" role="status">
          {waiting}
        </p>
      )}
      {loaded.kind === "access" && (
        <StateCard icon={KeyRoundIcon} text={locked} title="This needs an access code">
          <Button onClick={askForCode} variant="outline">
            Enter code
          </Button>
        </StateCard>
      )}
      {loaded.kind === "missing" && (
        <StateCard
          className="min-h-120"
          heading="h1"
          icon={CompassIcon}
          text="This photoshoot doesn't exist."
          title="Nothing here"
        >
          <Button asChild variant="outline">
            <Link to="/photoshoot">New photoshoot</Link>
          </Button>
        </StateCard>
      )}
      {loaded.kind === "error" && (
        <StateCard
          icon={TriangleAlertIcon}
          text={<span role="alert">{loaded.refusal.message}</span>}
          title="This didn't load"
          tone="warning"
        />
      )}

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}

/**
 * A photoshoot page's read: `read` once, again on `reload` (after an action, or once the access
 * code is entered), and every `pollMs` while `again(data)` holds; with the page's access code.
 */
export function usePhotoshootRead<T extends object>(
  read: (signal: AbortSignal) => Promise<{ data: T } | { refusal: Refusal }>,
  again: (data: T) => boolean = () => false,
  pollMs = 1500,
) {
  const access = useAccessCode();
  const nextSignal = useRequestSignal();
  // Bumped to read again.
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T>>({ kind: "loading" });
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  const askForCode = useCallback(
    () => access.hold("photoshoot", "unlock", reload),
    [access.hold, reload],
  );

  // The latest functions, so a re-render never restarts the read.
  const current = useRef({ again, read });

  current.current = { again, read };

  useEffect(() => {
    const signal = nextSignal();

    void current.current.read(signal).then((result) => {
      if (signal.aborted) {
        return;
      }

      if ("refusal" in result) {
        const { reason } = result.refusal;

        setLoaded(
          reason === "access_required" || reason === "not_found"
            ? { kind: reason === "not_found" ? "missing" : "access" }
            : { kind: "error", refusal: result.refusal },
        );

        return;
      }

      setLoaded({ kind: "ready", ...result.data });

      if (current.current.again(result.data)) {
        const timer = setTimeout(reload, pollMs);

        signal.addEventListener("abort", () => clearTimeout(timer));
      }
    });
  }, [nextSignal, pollMs, reload, version]);

  return { access, askForCode, loaded, reload, setLoaded };
}
