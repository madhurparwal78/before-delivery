/**
 * Graded motion runs on the page clock: a frame loop reads performance.now() and one finishing
 * timer ends it exactly on time. State is always written first; motion only reads it.
 */

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** cubic-bezier(0.2, 0, 0, 1): fast start, soft settle. */
function ease(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i += 1) {
    const t = (low + high) / 2;
    const at = 3 * 0.2 * (1 - t) ** 2 * t + t ** 3;
    if (at < x) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) * t ** 2 + t ** 3;
}

export interface Tween { cancel(): void }

/** Calls `frame(eased)` now with 0, on every animation frame, and at the end with exactly 1. */
export function tween(durationMs: number, frame: (eased: number) => void, done: () => void): Tween {
  const start = performance.now();
  let live = true;
  let raf = 0;
  const finish = () => {
    if (!live) return;
    live = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    frame(1);
    done();
  };
  const step = () => {
    if (!live) return;
    const raw = (performance.now() - start) / durationMs;
    if (raw >= 1) return finish();
    frame(ease(raw));
    raf = requestAnimationFrame(step);
  };
  const timer = setTimeout(finish, durationMs);
  frame(0);
  raf = requestAnimationFrame(step);
  return { cancel: () => { live = false; cancelAnimationFrame(raf); clearTimeout(timer); } };
}
