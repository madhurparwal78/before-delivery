/** requestAnimationFrame tweens (stepped by whatever clock drives the page) and the reduced-motion switch. */

export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fast start, soft arrival. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
export const easeOutQuad = (t: number): number => 1 - (1 - t) ** 2;

export const DURATIONS = {
  lensLag: 125,
  crossfade: 220,
  lensGrow: 360,
  towerTurn: 350,
  sheetSlide: 250,
} as const;

/**
 * Runs `update(progress)` from 0 to 1 over `duration` milliseconds, calling `done` after the last frame. The first
 * update (progress 0) runs synchronously. Returns a function that cancels the tween without finishing it.
 */
export const tween = (
  duration: number,
  update: (progress: number) => void,
  done?: () => void,
  ease: (t: number) => number = easeOut,
): (() => void) => {
  let frame = 0;
  let cancelled = false;
  const start = performance.now();
  update(0);
  const step = (): void => {
    if (cancelled) return;
    const elapsed = performance.now() - start;
    const progress = Math.min(1, elapsed / duration);
    update(ease(progress));
    if (progress < 1) {
      frame = requestAnimationFrame(step);
    } else {
      done?.();
    }
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
};
