import { useCallback, useEffect, useState } from "react";

import type { CharacterSummary } from "#/features/characters/contracts";
import { fetchLibrary } from "#/features/characters/library";
import type { Refusal } from "#/shared/requests";
import { useRequestSignal } from "#/shared/use-request-signal";

/** The workspace library as a page holds it: loading, read, refused for want of a code, failed. */
export type CharacterListState =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "error"; refusal: Refusal }
  | { characters: CharacterSummary[]; kind: "ready" };

/**
 * The list `GET /api/characters` answers for `favorites` and `q`, read again whenever they change
 * or `reload` is called (a read that is still running is dropped). A list already shown stays
 * while the next one loads. `enabled: false` reads nothing (no session to read it with).
 */
export function useCharacterList({
  enabled = true,
  favorites,
  q,
}: {
  enabled?: boolean;
  favorites?: boolean;
  q?: string;
}) {
  const [state, setState] = useState<CharacterListState>({ kind: "loading" });
  const [version, setVersion] = useState(0);
  const nextSignal = useRequestSignal();
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const signal = nextSignal();

    setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    void fetchLibrary({ favorites, q }, signal).then((result) => {
      if (signal.aborted) {
        return;
      }

      if ("data" in result) {
        setState({ characters: result.data.characters, kind: "ready" });
      } else if (result.refusal.reason === "access_required") {
        setState({ kind: "access" });
      } else {
        setState({ kind: "error", refusal: result.refusal });
      }
    });
  }, [enabled, favorites, nextSignal, q, version]);

  return { reload, setState, state };
}
