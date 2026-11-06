import { useSyncExternalStore } from "react";

const query = matchMedia("(prefers-reduced-motion: reduce)");

export function prefersReducedMotion(): boolean {
  return query.matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => query.matches,
  );
}
