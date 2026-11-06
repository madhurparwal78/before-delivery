// Browser conditions the layout follows: the three exact width bands and the reduced-motion request.

import { useEffect, useState } from "react";

export type Band = "narrow" | "medium" | "wide";

const NARROW = "(max-width: 639px)";
const WIDE = "(min-width: 1024px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

function bandNow(): Band {
  if (window.matchMedia(NARROW).matches) return "narrow";
  return window.matchMedia(WIDE).matches ? "wide" : "medium";
}

function useMedia<T>(queries: readonly string[], read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const lists = queries.map((q) => window.matchMedia(q));
    const update = (): void => setValue(read());
    lists.forEach((list) => list.addEventListener("change", update));
    update();
    return () => lists.forEach((list) => list.removeEventListener("change", update));
  }, [queries, read]);
  return value;
}

const BAND_QUERIES = [NARROW, WIDE];
const REDUCED_QUERIES = [REDUCED];
const reducedNow = (): boolean => window.matchMedia(REDUCED).matches;

/** Narrow 0-639, medium 640-1023, wide 1024 and up: the only thing that decides a layout. */
export function useBand(): Band {
  return useMedia(BAND_QUERIES, bandNow);
}

export function useReducedMotion(): boolean {
  return useMedia(REDUCED_QUERIES, reducedNow);
}

/** Motion is skipped entirely when reduced motion is requested. */
export function prefersReducedMotion(): boolean {
  return reducedNow();
}
