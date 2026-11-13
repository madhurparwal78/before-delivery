import { useSyncExternalStore } from "react";

// The system preference decides every published motion duration: reduced reads zero.

const query = window.matchMedia("(prefers-reduced-motion: reduce)");

function subscribe(listener: () => void): () => void {
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => query.matches);
}

/** True when animations should be skipped right now (read at call time, not render time). */
export function reducedNow(): boolean {
  return query.matches;
}

export const MOTION = {
  gallery: 280,
  drawer: 320,
  totals: 180,
  toast: 200,
  gauge: 420,
  gaugeSettle: 700,
} as const;

/** A published duration, zero under reduced motion. */
export function useMotionMs(ms: number): number {
  return useReducedMotion() ? 0 : ms;
}

export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

const tweens = new WeakMap<HTMLElement, number>();

/** Calls `frame(t)` with the eased progress 0..1 on every animation frame of the page clock; the last call is t = 1. */
export function tween(el: HTMLElement, ms: number, frame: (t: number) => void): void {
  const previous = tweens.get(el);
  if (previous !== undefined) cancelAnimationFrame(previous);
  const start = performance.now();
  const step = (): void => {
    const raw = Math.min(1, (performance.now() - start + 16) / ms);
    frame(raw === 1 ? 1 : 1 - Math.pow(2, -10 * raw));
    if (raw < 1) tweens.set(el, requestAnimationFrame(step));
    else tweens.delete(el);
  };
  tweens.set(el, requestAnimationFrame(step));
}
