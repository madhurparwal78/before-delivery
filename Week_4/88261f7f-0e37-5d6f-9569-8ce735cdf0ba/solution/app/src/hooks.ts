import { useEffect, useRef, useState } from "react";

const PHONE_MAX = 600;
const TABLET_MAX = 1023;
export const PANEL_MS = 250;

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useReducedMotion = (): boolean => useMedia("(prefers-reduced-motion: reduce)");

type Layout = "phone" | "tablet" | "desktop";

export function useLayout(): Layout {
  const phone = useMedia(`(max-width: ${PHONE_MAX}px)`);
  const tablet = useMedia(`(max-width: ${TABLET_MAX}px)`);
  return phone ? "phone" : tablet ? "tablet" : "desktop";
}

/** Counts requests so a late answer can tell it is no longer the newest. */
export function useSequence(): { next: () => number; isNewest: (id: number) => boolean } {
  const count = useRef(0);
  const api = useRef({ next: () => ++count.current, isNewest: (id: number) => id === count.current });
  return api.current;
}

/** True while an async action runs; a second press while busy does nothing. */
export function useBusy(): [boolean, <T>(work: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const flag = useRef(false);
  const guard = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (flag.current) return undefined;
    flag.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      flag.current = false;
      setBusy(false);
    }
  };
  return [busy, guard];
}
