// Shared hooks: polling on the page clock, viewport tiers, reduced motion and announcement regions.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { quietly } from "./api";

/** Runs `load` now and every `ms`, never overlapping itself. */
export function usePoll(load: () => Promise<unknown>, ms: number, deps: unknown[]): () => void {
  const latest = useRef(load);
  latest.current = load;
  const busy = useRef(false);
  const run = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    quietly(latest.current().finally(() => {
      busy.current = false;
    }));
  }, []);
  useEffect(() => {
    busy.current = false;
    run();
    const timer = window.setInterval(run, ms);
    return () => window.clearInterval(timer);
  }, deps);
  return run;
}

type Tier = "wide" | "medium" | "narrow";

const tierOf = () => (window.innerWidth >= 1024 ? "wide" : window.innerWidth >= 600 ? "medium" : "narrow");

/** Each published viewport gets its own layout: 1280 wide, 768 medium, 375 narrow. */
export function useTier(): Tier {
  return useSyncExternalStore((l) => {
    window.addEventListener("resize", l);
    return () => window.removeEventListener("resize", l);
  }, tierOf);
}

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function useReducedMotion(): boolean {
  return useSyncExternalStore((l) => {
    motionQuery.addEventListener("change", l);
    return () => motionQuery.removeEventListener("change", l);
  }, () => motionQuery.matches);
}

export const reducedMotion = () => motionQuery.matches;

/**
 * An announcement region's lines. Events from one tick are written together; a later event replaces them.
 * Repaints never rewrite or clear what is there.
 */
export function useAnnouncer(): [string[], (text: string) => void] {
  const [lines, setLines] = useState<string[]>([]);
  const pending = useRef<string[]>([]);
  const announce = useCallback((text: string) => {
    if (!pending.current.length) {
      queueMicrotask(() => {
        const batch = pending.current;
        pending.current = [];
        setLines(batch);
      });
    }
    pending.current.push(text);
  }, []);
  return [lines, announce];
}
