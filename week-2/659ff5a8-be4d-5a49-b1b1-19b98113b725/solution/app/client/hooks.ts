import { useCallback, useEffect, useRef, useState } from "react";

/** Run `load` now, every `seconds`, and whenever the tab regains focus; returns a function to re-read at once. */
export function useRefresh(load: () => Promise<void>, seconds: number, deps: unknown[]): () => void {
  const latest = useRef(load);
  latest.current = load;
  const run = useCallback((): void => {
    latest.current().catch(() => undefined);
  }, []);
  useEffect(() => {
    run();
    const timer = window.setInterval(run, seconds * 1000);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, deps);
  return run;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
