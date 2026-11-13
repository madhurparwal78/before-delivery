import { useSyncExternalStore } from "react";

const COMPACT = "(max-width: 767px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

function useQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Compact layout: 0 to 767 px wide, decided by the viewport width alone. */
export const useCompact = (): boolean => useQuery(COMPACT);

export const useReducedMotion = (): boolean => useQuery(REDUCED);
