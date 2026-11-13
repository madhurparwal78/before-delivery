export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const DURATION = { settle: 220, loupe: 280, sheet: 280, slide: 350 } as const;

/** Runs an animation unless the system asks for reduced motion; resolves when it ends. */
export function play(element: Element, keyframes: Keyframe[], duration: number): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  return element
    .animate(keyframes, { duration, easing: EASE })
    .finished.then(
      () => undefined,
      () => undefined,
    );
}

interface Tween {
  duration: number;
  start: number | null;
  apply: (progress: number) => void;
  finish: () => void;
}

const running = new Map<HTMLElement, Tween>();
let frame = 0;

/** Starts soft: fast at first, settling at the end. */
const settle = (t: number): number => 1 - (1 - t) ** 3;

function step(now: number): void {
  frame = 0;
  for (const [element, tween] of running) {
    tween.start ??= now;
    const t = Math.min((now - tween.start) / tween.duration, 1);
    if (t < 1) {
      tween.apply(settle(t));
    } else {
      tween.finish();
      running.delete(element);
    }
  }
  if (running.size > 0) frame = requestAnimationFrame(step);
}

/**
 * Moves an element along a path of its own over `duration`, one animation frame at a time, so the motion follows the
 * page's frame clock. `apply` sets the styles for a progress from 0 to 1; `finish` removes them. A new tween on the
 * same element replaces the one running.
 */
export function tween(element: HTMLElement, duration: number, apply: (progress: number) => void, finish: () => void): void {
  running.get(element)?.finish();
  running.set(element, { duration, start: null, apply, finish });
  apply(0);
  if (frame === 0) frame = requestAnimationFrame(step);
}
