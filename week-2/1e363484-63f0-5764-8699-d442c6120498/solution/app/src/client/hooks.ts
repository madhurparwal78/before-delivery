import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * A polite live region the component renders empty and this hook writes into. Writing the text that
 * is already there empties it first, so a repeated message is announced again.
 */
export function useAnnouncer() {
  const region = useRef<HTMLDivElement>(null);
  const announce = useCallback((text: string) => {
    const el = region.current;
    if (!el) return;
    if (el.textContent === text) {
      el.textContent = "";
      requestAnimationFrame(() => {
        el.textContent = text;
      });
    } else el.textContent = text;
  }, []);
  return { region, announce };
}

const REFRESH_MS = 15_000;

/** Calls `refresh` every 15 seconds while the tab is visible, and when it becomes visible; never while paused. */
export function useRefresh(refresh: () => void, paused: () => boolean): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  const isPaused = useRef(paused);
  isPaused.current = paused;
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible" && !isPaused.current()) latest.current();
    };
    const timer = setInterval(run, REFRESH_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => matchMedia(query).matches,
  );
}

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
