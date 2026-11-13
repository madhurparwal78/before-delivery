/**
 * Motion explains a change in staffing or in what you are looking at; nothing else moves.
 * Every movement starts quickly and settles softly, and a reduced-motion preference swaps it for
 * an instant change (no animation is started at all).
 */
import { useEffect, useRef } from "react";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

export const DURATION = {
  pane: 300,
  dialog: 120,
  status: 300,
  crossover: 120,
  fill: 300,
  fillStagger: 40,
} as const;

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs a WAAPI animation unless reduced motion is requested; returns null when it did not run. */
export function play(element: Element | null, keyframes: Keyframe[], duration: number): Animation | null {
  if (!element || reducedMotion()) return null;
  return element.animate(keyframes, { duration, easing: EASE_OUT });
}

/** Repeats a callback on an interval, always calling its latest version. */
export function useInterval(callback: () => void, ms: number): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const id = setInterval(() => latest.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** The brief's re-read cadence for live screens. */
export const REFRESH_MS = 10_000;
