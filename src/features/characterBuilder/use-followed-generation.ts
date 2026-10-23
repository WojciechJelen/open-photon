import { useEffect, useState } from "react";

import { readGeneration } from "#/features/characterBuilder/builder-client";
import type { GenerationSnapshot } from "#/shared/contracts";
import type { Refusal } from "#/shared/requests";
import { useLiveGeneration } from "#/shared/use-live-generation";

type Loaded<T> =
  | { state: "loading" }
  | { refusal: Refusal; state: "refused" }
  | { data: T; state: "ready" };

type Read<T> = (id: string) => Promise<{ data: T } | { refusal: Refusal }>;

/**
 * What `read` answers for `id` (a generation's snapshot, its recipe), read once for the screen
 * that shows it; `reload` reads it again after a refusal (no connection, the access code
 * expired).
 */
export function useStored<T>(id: string, read: Read<T>) {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;

    setLoaded({ state: "loading" });

    void read(id).then((answer) => {
      if (!stopped) {
        setLoaded(
          "refusal" in answer
            ? { refusal: answer.refusal, state: "refused" }
            : { data: answer.data, state: "ready" },
        );
      }
    });

    return () => {
      stopped = true;
    };
  }, [id, read, attempt]);

  return { loaded, reload: () => setAttempt((count) => count + 1) };
}

/** A generation's stored snapshot (`GET /api/generations/:id`), as `useStored` reads it. */
export function useStoredGeneration(id: string) {
  return useStored(id, readGeneration);
}

// How long to wait before reading a done generation again whose output is not there yet.
const RELOAD_MS = 2000;

/**
 * The generation live (`useLiveGeneration`, its event stream) from `initial`, until it ends, and
 * once it is done, its output `name`. A done snapshot carries its outputs; should one come
 * without (`output` missing), it is read again every `RELOAD_MS` until it has it, so the page
 * never stays on "Finishing".
 */
export function useFollowedGeneration(initial: GenerationSnapshot, name: string) {
  const live = useLiveGeneration(initial);
  const [reread, setReread] = useState<GenerationSnapshot | null>(null);
  const generation = reread ?? live.generation;
  const output = generation.outputs.find((candidate) => candidate.name === name) ?? null;
  const missing = generation.status === "done" && output === null;

  useEffect(() => {
    if (!missing) {
      return;
    }

    const timer = setTimeout(() => {
      void readGeneration(generation.id).then((answer) => {
        if ("data" in answer) {
          setReread(answer.data);
        }
      });
    }, RELOAD_MS);

    return () => clearTimeout(timer);
  }, [missing, generation]);

  return {
    // Done by the stream but its output not there yet: still finishing, as far as the page shows.
    generation: missing ? { ...generation, status: "finalizing" as const } : generation,
    output,
    providerUnavailable: live.providerUnavailable,
  };
}
