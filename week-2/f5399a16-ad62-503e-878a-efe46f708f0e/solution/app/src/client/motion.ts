// SR3 and SR23: reduced motion is read at each animation, so turning it on or off needs no reload.

export const FAST = 160;
export const BASE = 320;
export const EASE = 'cubic-bezier(.2,.7,.2,1)';

export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isRtl(): boolean {
  return document.documentElement.dir === 'rtl';
}

export type Rect = { left: number; top: number };

/** Moved elements travel from where they were, as the same elements. */
export function travel(element: Element, from: Rect, duration = BASE): void {
  const to = element.getBoundingClientRect();
  const x = from.left - to.left;
  const y = from.top - to.top;
  if ((Math.abs(x) < 1 && Math.abs(y) < 1) || reducedMotion()) return;
  element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], { duration, easing: EASE });
}
