import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

/** What a photoshoot page has read: nothing yet, a refusal for the code, another refusal, or `T`. */
export type Loaded<T> =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "error"; refusal: Refusal }
  | ({ kind: "ready" } & T);

/**
 * The frame of both photoshoot pages: the header with the access status, the loading, access and
 * error states of what the page reads, and the page's access-code dialog; `children` once ready.
 */
export function PhotoshootShell({
  access,
  askForCode,
  children,
  locked,
  loaded,
  waiting,
}: {
  access: ReturnType<typeof useAccessCode>;
  askForCode: () => void;
  children: ReactNode;
  locked: string;
  loaded: Loaded<object>;
  waiting: string;
}) {
  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Image">
        {loaded.kind !== "loading" && (
          <AccessStatus onOpen={askForCode} signedIn={loaded.kind !== "access"} />
        )}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        {children}
        {loaded.kind === "loading" && (
          <p className="text-muted-foreground" role="status">
            {waiting}
          </p>
        )}
        {loaded.kind === "access" && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-soft-foreground">{locked}</p>
            <Button onClick={askForCode} variant="outline">
              Enter code
            </Button>
          </div>
        )}
        {loaded.kind === "error" && (
          <p className="text-destructive-foreground" role="alert">
            {loaded.refusal.message}
          </p>
        )}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
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
        setLoaded(
          result.refusal.reason === "access_required"
            ? { kind: "access" }
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
