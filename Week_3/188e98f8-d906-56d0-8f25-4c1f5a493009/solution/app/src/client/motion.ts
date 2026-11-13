import tokens from "../shared/tokens.json";

const [x1, y1, x2, y2] = tokens.easePoints as [number, number, number, number];

/** The one easing curve, solved for rAF-driven motion (CSS and WAAPI use the same token string). */
export function ease(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const middle = (low + high) / 2;
    if (at(x1, x2, middle) < progress) low = middle;
    else high = middle;
  }
  return at(y1, y2, (low + high) / 2);
}

export const EASING = tokens.ease;
export const MS = tokens.ms;

/** The first part of the 600ms pane / sheet run that rests at the start position before the ease begins (DESIGN.md Motion, pane hold). */
export const PANE_HOLD_MS = 160;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fade used by every reduced-motion substitute. */
export function fade(element: Element): Animation {
  return element.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: MS.reduced, easing: EASING });
}
