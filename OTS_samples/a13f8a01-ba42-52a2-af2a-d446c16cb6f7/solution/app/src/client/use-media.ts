import { useSyncExternalStore } from "react";

type Band = "wide" | "medium" | "narrow";

function watch(queries: readonly string[]): (listener: () => void) => () => void {
  return (listener) => {
    const lists = queries.map((query) => window.matchMedia(query));
    for (const list of lists) list.addEventListener("change", listener);
    return () => {
      for (const list of lists) list.removeEventListener("change", listener);
    };
  };
}

const BAND_QUERIES = ["(min-width: 1024px)", "(min-width: 768px)"] as const;
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

const bandNow = (): Band => (window.matchMedia(BAND_QUERIES[0]).matches ? "wide" : window.matchMedia(BAND_QUERIES[1]).matches ? "medium" : "narrow");

export function useBand(): Band {
  return useSyncExternalStore(watch(BAND_QUERIES), bandNow);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(watch([REDUCED_QUERY]), () => window.matchMedia(REDUCED_QUERY).matches);
}
