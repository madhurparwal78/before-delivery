import { useEffect, useRef, useState } from "react";

export function useMediaQuery(query: string): boolean {
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

export const WIDE = "(min-width: 768px)";
export const FULL = "(min-width: 1280px)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const POLL_INTERVAL_MS = 2000;

/**
 * Calls `load` now and then on the board cadence, whether or not an earlier call has answered.
 * Each call gets a sequence number so the caller can drop an answer older than the one on screen.
 */
export function usePolling(load: (sequence: number) => void | Promise<void>, enabled: boolean): void {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    if (!enabled) return undefined;
    let sequence = 0;
    const tick = (): void => {
      sequence += 1;
      void latest.current(sequence);
    };
    tick();
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
