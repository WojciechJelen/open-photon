import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { type Allowance, sessionStatusSchema } from "#/shared/contracts";
import { callApi, onApiWrite } from "#/shared/requests";

// The read every header on the page shares while it is on its way (the Motion Transfer header
// shows the status twice: wide and compact).
let reading: Promise<Allowance | null> | null = null;

/** `GET /api/session`'s allowance, or `null` when it cannot be read; `fresh` starts a new read. */
function readAllowance(fresh: boolean) {
  if (fresh || !reading) {
    const read: Promise<Allowance | null> = callApi(sessionStatusSchema, "/api/session", {
      headers: { Accept: "application/json" },
    })
      .then((result) => ("data" in result ? result.data.allowance : null))
      .catch(() => null)
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
 * What the session's access code still allows, read when `signedIn` turns true, on every route
 * change, when the window gets the focus back and after every accepted write (`onApiWrite`: a
 * render spends a generation). `null` without a session, while a read is on its way, or when it
 * failed, so a stale or wrong count is never shown.
 */
export function useAllowance(signedIn: boolean) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [allowance, setAllowance] = useState<Allowance | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setAllowance(null);

      return;
    }

    let latest = 0;
    let active = true;

    const refresh = (fresh: boolean) => {
      const ask = ++latest;

      setAllowance(null);
      void readAllowance(fresh).then((read) => {
        if (active && ask === latest) {
          setAllowance(read);
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
  }, [pathname, signedIn]);

  return allowance;
}
