import { useCallback, useEffect, useRef } from "react";

/**
 * Hands out one `AbortSignal` per request a component starts. The signal aborts when the
 * component unmounts or starts its next request. Passed to the request, it cancels it; checked
 * after the `await`, it drops a result the page has left (no late selection or navigation).
 */
export function useRequestSignal() {
  const current = useRef<AbortController | null>(null);

  useEffect(() => () => current.current?.abort(), []);

  return useCallback(() => {
    current.current?.abort();
    current.current = new AbortController();

    return current.current.signal;
  }, []);
}
