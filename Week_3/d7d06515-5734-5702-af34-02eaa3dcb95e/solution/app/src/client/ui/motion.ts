// Graded motion is element.animate(); this is the one place that knows the brief's durations and the reduced-motion switch.
export const DRAW_MS = 900;
export const STAGGER_MS = 40;
export const GRIP_POP_MS = 160;
export const HEADER_IN_MS = 200;
export const HEADER_OUT_MS = 150;

export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Reads a design token (tokens.css) so durations and easings in script cannot drift from the stylesheet. */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Reveals a path (drawn with pathLength=1) from start to end, `order` steps after the first. */
export function drawPath(path: Element, order: number, duration = DRAW_MS): Animation {
  return path.animate(
    { strokeDashoffset: [1, 0] },
    { duration, delay: order * STAGGER_MS, easing: token('--ease-draw'), fill: 'both', iterations: 1 },
  );
}

/** Grows a grip from nothing; `delay` is when its path completes. */
export function popGrip(grip: Element, delay: number): Animation {
  return grip.animate(
    { transform: ['scale(0)', 'scale(1)'] },
    { duration: GRIP_POP_MS, delay, easing: token('--ease-draw'), fill: 'both', iterations: 1 },
  );
}
