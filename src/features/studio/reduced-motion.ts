import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const motion = window.matchMedia(query);

  motion.addEventListener("change", onChange);

  return () => motion.removeEventListener("change", onChange);
}

/** Whether the visitor asked for less motion; the server cannot tell, so it renders as if not. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
