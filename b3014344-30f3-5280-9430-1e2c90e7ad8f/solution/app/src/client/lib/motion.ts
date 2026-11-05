import { useEffect, useState } from "react";

// Graded motion runs on requestAnimationFrame and performance.now(), the page clock, so it plays the
// same whether the clock runs freely or is stepped.

const QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return reduced;
}

/** Brisk start, gentle settle: the easing every graded movement uses. */
export function settle(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** Runs `frame(progress 0..1)` for `duration` ms on animation frames; returns a cancel function. */
export function tween(duration: number, frame: (progress: number) => void, done?: () => void): () => void {
  let handle = 0;
  let start: number | null = null;
  const step = (now: number) => {
    if (start === null) start = now;
    const progress = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
    frame(progress);
    if (progress < 1) handle = requestAnimationFrame(step);
    else done?.();
  };
  handle = requestAnimationFrame(step);
  return () => cancelAnimationFrame(handle);
}
