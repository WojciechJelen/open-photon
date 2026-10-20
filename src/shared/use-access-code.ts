import { useCallback, useRef, useState } from "react";

import type { HeldAction } from "#/shared/components/access-code-dialog";

type Held = { action: HeldAction; resume: () => void; waits: boolean };

/**
 * Holds an action until the access code works: `key` names its place on the page (a newer hold of
 * the same key replaces it), `action` what the dialog says it carries on with, `resume` what runs
 * then. `waits`: the page shows it as waiting (a file in its upload tile), so closing the dialog
 * keeps it.
 */
export type HoldForCode = (
  key: string,
  action: HeldAction,
  resume: () => void,
  options?: { waits?: boolean },
) => void;

/**
 * One access-code dialog for a page, and the actions waiting for its code. `hold` opens the
 * dialog for an action and keeps it; `unlock` opens it on its own (the header's chip). Any
 * successful sign-in, however the dialog was opened, runs every held action once. Closing it
 * without a code drops what nothing on the page shows as waiting; a waiting action stays until
 * `release` (cancelled, or its tile left) or a sign-in. `dialog` is the dialog's props.
 */
export function useAccessCode() {
  const held = useRef(new Map<string, Held>());

  const [shown, setShown] = useState<{ action: HeldAction; open: boolean }>({
    action: "unlock",
    open: false,
  });

  const hold = useCallback<HoldForCode>((key, action, resume, options) => {
    held.current.set(key, { action, resume, waits: options?.waits ?? false });
    setShown({ action, open: true });
  }, []);

  const release = useCallback((key: string) => {
    held.current.delete(key);
  }, []);

  const unlock = useCallback(() => {
    setShown({ action: [...held.current.values()].at(-1)?.action ?? "unlock", open: true });
  }, []);

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) {
      for (const [key, { waits }] of held.current) {
        if (!waits) {
          held.current.delete(key);
        }
      }
    }

    setShown((previous) => ({ ...previous, open }));
  }, []);

  const onSignedIn = useCallback(() => {
    const waiting = [...held.current.values()];

    held.current.clear();

    for (const { resume } of waiting) {
      resume();
    }
  }, []);

  return {
    dialog: { action: shown.action, onOpenChange, onSignedIn, open: shown.open },
    hold,
    release,
    unlock,
  };
}
