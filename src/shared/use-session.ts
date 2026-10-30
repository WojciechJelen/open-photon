import { rootRouteId, useMatch, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { sessionStatusSchema, type SessionStatus } from "#/shared/contracts";
import { callApi, onApiWrite } from "#/shared/requests";

// The read on its way, which a route change and the window's focus share.
let reading: Promise<SessionStatus | null | undefined> | null = null;

/**
 * `GET /api/session`: the status, `null` when the session is gone, `undefined` when it could not
 * be read. `fresh` starts a new read.
 */
function readStatus(fresh: boolean) {
  if (fresh || !reading) {
    const read: Promise<SessionStatus | null | undefined> = callApi(
      sessionStatusSchema,
      "/api/session",
      { headers: { Accept: "application/json" } },
    )
      .then((result) => {
        if ("data" in result) {
          return result.data;
        }

        return result.refusal.reason === "access_required" ? null : undefined;
      })
      .catch(() => undefined)
      .finally(() => {
        if (reading === read) {
          reading = null;
        }
      });

    reading = read;
  }

  return reading;
}

/**
 * The visitor's session, `null` without one: what the server knew when it rendered the page
 * (`loadSession`, the root route's loader, again after a sign-in), then, with a session, read
 * again on every route change, when the window gets the focus back and after every accepted write
 * (`onApiWrite`: a render spends a generation). The last answer stays while a read is on its way
 * and when one fails, so the header holds still.
 */
export function useSession() {
  const loaded =
    useMatch({ from: rootRouteId, select: (match) => match.loaderData, shouldThrow: false }) ??
    null;

  const pathname = useRouterState({ select: (state) => state.location.pathname });

  // What a read answered, for the session it was read on: a newer `loaded` replaces it.
  const [read, setRead] = useState<{ on: typeof loaded; status: SessionStatus | null } | null>(
    null,
  );

  const session = read?.on === loaded ? read.status : loaded;
  const signedIn = session !== null;

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    let latest = 0;
    let active = true;

    const refresh = (fresh: boolean) => {
      const ask = ++latest;

      void readStatus(fresh).then((status) => {
        if (active && ask === latest && status !== undefined) {
          setRead({ on: loaded, status });
        }
      });
    };

    const onFocus = () => refresh(false);
    const unsubscribe = onApiWrite(() => refresh(true));

    refresh(false);
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [loaded, pathname, signedIn]);

  return session;
}
