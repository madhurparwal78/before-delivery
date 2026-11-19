import { useCallback, useEffect, useMemo, useRef } from "react";

/** Calls `tick` every `ms` on the page clock for as long as `active` holds. */
export function useInterval(tick: () => void, ms: number, active = true): void {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => latest.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
}

/** Tokens for "latest input wins": only the answer to the most recent request is applied. */
export function useLatestRequest(): { begin: () => number; isLatest: (token: number) => boolean } {
  const counter = useRef(0);
  const begin = useCallback(() => ++counter.current, []);
  const isLatest = useCallback((token: number) => token === counter.current, []);
  return useMemo(() => ({ begin, isLatest }), [begin, isLatest]);
}

/** Search boxes apply a third of a second after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 333;

export function useDebounced(fn: () => void, ms: number): (immediate?: boolean) => void {
  const latest = useRef(fn);
  latest.current = fn;
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback((immediate = false) => {
    window.clearTimeout(timer.current);
    if (immediate) latest.current();
    else timer.current = window.setTimeout(() => latest.current(), ms);
  }, [ms]);
}
