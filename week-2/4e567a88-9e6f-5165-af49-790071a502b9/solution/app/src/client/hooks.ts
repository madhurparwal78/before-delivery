// Small shared browser helpers: routing, polling on page timers, media queries and display formats.

import { useEffect, useRef, useState } from "preact/hooks";
import { formatCredits } from "../shared/money";
import { localMinutes, longDate } from "../shared/tz";

// ---- routing -------------------------------------------------------------------------------------

export type Screen = "run" | "jobs" | "library" | "webhooks" | "finance" | "admin";
export const SCREEN_NAMES: Record<Screen, string> = {
  run: "Run", jobs: "Jobs", library: "Library", webhooks: "Webhooks", finance: "Finance", admin: "Admin",
};

const listeners = new Set<() => void>();

export function navigate(path: string): void {
  if (location.pathname !== path) history.pushState(null, "", path);
  listeners.forEach((listener) => listener());
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const sync = () => setPath(location.pathname);
    listeners.add(sync);
    addEventListener("popstate", sync);
    return () => {
      listeners.delete(sync);
      removeEventListener("popstate", sync);
    };
  }, []);
  return path;
}

// ---- timers --------------------------------------------------------------------------------------

/**
 * Runs `tick` now and then every `ms` on page timers, and again whenever `refreshAll()` fires.
 * A tick never overlaps the previous one.
 */
export function usePoll(tick: () => Promise<unknown>, ms: number, deps: unknown[]): void {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let timer = 0;
    const run = async () => {
      window.clearTimeout(timer);
      if (stopped) return;
      if (!busy) {
        busy = true;
        try {
          await latest.current();
        } catch {
          // A failed poll keeps the last good view; the next tick tries again.
        }
        busy = false;
      }
      if (!stopped) timer = window.setTimeout(run, ms);
    };
    const now = () => void run();
    void run();
    addEventListener("dispatch:refresh", now);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      removeEventListener("dispatch:refresh", now);
    };
  }, deps);
}

/** Re-renders once a second (elapsed counters). */
export function useSecondTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
}

export function useMedia(queryText: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(queryText).matches);
  useEffect(() => {
    const list = matchMedia(queryText);
    const sync = () => setMatches(list.matches);
    sync();
    list.addEventListener("change", sync);
    return () => list.removeEventListener("change", sync);
  }, [queryText]);
  return matches;
}

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const EASE = "cubic-bezier(0.2, 0, 0, 1)";
export const SHORT_MS = 220;
export const RIBBON_MS = 420;

// ---- org time zone and display formats ------------------------------------------------------------

let orgZone = document.querySelector<HTMLMetaElement>('meta[name="org-timezone"]')?.content || "America/New_York";
export const getOrgZone = (): string => orgZone;
export const setOrgZone = (zone: string): void => {
  orgZone = zone;
};

/** Credits for a JSON micro amount: "3,180.00". */
export const credits = (micro: number | bigint): string => formatCredits(BigInt(micro));

/** "2026-11-02 09:00" in the org time zone. */
export const when = (iso: string | null): string => (iso ? localMinutes(Date.parse(iso), orgZone) : "—");

/** "1 November 2026" in the org time zone. */
export const day = (iso: string): string => longDate(Date.parse(iso), orgZone);

export const personName = (who: { id: string; name: string } | string | null | undefined): string =>
  who === null || who === undefined ? "—" : typeof who === "string" ? who : who.name;

export const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
