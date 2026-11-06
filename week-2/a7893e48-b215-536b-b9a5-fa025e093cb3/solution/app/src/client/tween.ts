import { useEffect, useRef, useState } from "react";

/** Durations from the brief's three steps (Motion and effects). */
export const MOTION = { snap: 90, numeral: 250, slide: 250, dialogIn: 250, large: 450 } as const;

/** Starts fast and settles gently. */
const easeOut = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

const query = window.matchMedia("(prefers-reduced-motion: reduce)");

function reducedMotion(): boolean {
  return query.matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reducedMotion());
  useEffect(() => {
    const update = (): void => setReduced(reducedMotion());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Animates a value on requestAnimationFrame (so the page clock drives it); with reduced motion the
 * end value lands in the same call. Returns a cancel function.
 */
export function tween(duration: number, step: (progress: number) => void, done?: () => void, ease: (t: number) => number = easeOut): () => void {
  if (reducedMotion() || duration <= 0) {
    step(1);
    done?.();
    return () => undefined;
  }
  const started = performance.now();
  let frame = 0;
  const tick = (now: number): void => {
    const t = Math.min(1, Math.max(0, (now - started) / duration));
    step(ease(t));
    if (t < 1) frame = requestAnimationFrame(tick);
    else done?.();
  };
  step(0);
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/** A number that rolls to its new value over `duration`. */
export function useTweened(target: number, duration: number): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (from === target) return undefined;
    return tween(duration, (progress) => {
      current.current = from + (target - from) * progress;
      setShown(current.current);
    });
  }, [target, duration]);
  return shown;
}

/** Fades and rises an element into place (dialogs). */
export function enter(element: HTMLElement, rise: number, duration: number): () => void {
  return tween(duration, (progress) => {
    element.style.opacity = String(progress);
    element.style.transform = progress >= 1 ? "" : `translateY(${(rise * (1 - progress)).toFixed(2)}px)`;
  });
}
