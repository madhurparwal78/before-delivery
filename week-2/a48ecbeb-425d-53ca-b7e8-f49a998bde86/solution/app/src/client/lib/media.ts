import { useSyncExternalStore } from "react";

/** Live result of a media query (viewport width, reduced motion). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => window.matchMedia(query).matches,
  );
}

export const PHONE = "(max-width: 699px)";
export const DESKTOP = "(min-width: 1200px)";
export const REDUCED = "(prefers-reduced-motion: reduce)";

export const prefersReduced = (): boolean => window.matchMedia(REDUCED).matches;
