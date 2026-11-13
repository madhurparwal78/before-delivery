import { useEffect, useState } from "react";

/** Reduced-motion preference and the motion timing helpers. */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Ring resize takes a little under a quarter second; the count follows. */
export const TIMINGS = {
  ringResize: 0.22,
  slackCount: 0.33,
  inkChange: 0.16,
  conflictFlash: 0.16,
  sheetIn: 0.25,
  sheetOut: 0.2
} as const;

/** Animate a number step by step over the given duration. */
export function countSteps(
  from: number,
  to: number,
  durationMs: number,
  onStep: (value: number) => void,
  reducedMotion: boolean
): () => void {
  if (reducedMotion || from === to) {
    onStep(to);
    return () => undefined;
  }
  const start = performance.now();
  let raf = 0;
  const tick = (now: number): void => {
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / durationMs);
    const stepped = Math.round(from + (to - from) * progress);
    onStep(stepped);
    if (progress < 1 && stepped !== to) {
      raf = requestAnimationFrame(tick);
    } else {
      onStep(to);
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Animate a ring radius toward its target. */
export function tween(
  from: number,
  to: number,
  durationMs: number,
  onStep: (value: number) => void,
  reducedMotion: boolean
): () => void {
  if (reducedMotion || from === to) {
    onStep(to);
    return () => undefined;
  }
  const start = performance.now();
  let raf = 0;
  const tick = (now: number): void => {
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / durationMs);
    // Fast start, long gentle finish.
    const eased = 1 - Math.pow(1 - progress, 3);
    onStep(from + (to - from) * eased);
    if (progress < 1) raf = requestAnimationFrame(tick);
    else onStep(to);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
