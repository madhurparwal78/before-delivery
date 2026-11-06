// Re-reads and in-place updates (brief: Interactions › Re-reads), the published breakpoints and the
// idempotency key a lost-answer form holds until the server answers.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { newIdempotencyKey } from "./api.js";
import { isSignInAgainOpen } from "./signInAgainState.js";

/** Runs `read` every `ms` while `enabled`, never overlapping and paused while Sign in again is open. */
export function usePoll(read: () => Promise<void>, ms: number, enabled = true): void {
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    if (!enabled) return undefined;
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy || isSignInAgainOpen()) return;
      busy = true;
      latest.current()
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    }, ms);
    return () => window.clearInterval(timer);
  }, [ms, enabled]);
}

/**
 * Commits a re-read's update synchronously and keeps the user where they were: the focused control
 * keeps focus even when its row moved, the scroll position stays, and when the focused control was
 * removed, `lost` names the element that takes focus instead.
 */
export function applyInPlace(update: () => void, lost?: (row: string | null) => HTMLElement | null): void {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const row = focused?.closest("[data-row]")?.getAttribute("data-row") ?? null;
  const scrollY = window.scrollY;
  flushSync(update);
  if (focused && focused !== document.body && document.activeElement !== focused) {
    if (focused.isConnected) focused.focus({ preventScroll: true });
    else lost?.(row)?.focus({ preventScroll: true });
  }
  if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
}

function mediaStore(query: string): { subscribe: (listener: () => void) => () => void; read: () => boolean } {
  const list = window.matchMedia(query);
  return {
    subscribe: (listener) => {
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    read: () => list.matches,
  };
}

const TWO_PANES = mediaStore("(min-width: 768px)");
const REDUCED_MOTION = mediaStore("(prefers-reduced-motion: reduce)");

/** True from 768 px wide (two panes, the table form of the care round, the visible navigation). */
export function useTwoPanes(): boolean {
  return useSyncExternalStore(TWO_PANES.subscribe, TWO_PANES.read);
}

export function prefersReducedMotion(): boolean {
  return REDUCED_MOTION.read();
}

/** The key a lost-answer form holds from its first press until a server answer or the form closes. */
export function useIdempotencyKey(): { take: () => string; discard: () => void } {
  const key = useRef<string | null>(null);
  const take = useCallback(() => {
    key.current ??= newIdempotencyKey();
    return key.current;
  }, []);
  const discard = useCallback(() => {
    key.current = null;
  }, []);
  return { take, discard };
}

/** Loads a screen's data on open; `missing` is true when the record is not there for this user. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  setData: (next: T) => void;
  missing: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    setMissing(false);
    load().then(
      (value) => {
        if (live) setData(value);
      },
      () => {
        if (live) setMissing(true);
      },
    );
    return () => {
      live = false;
    };
  }, deps); // the screen supplies its own dependencies (usually the record id)
  return { data, setData, missing };
}
