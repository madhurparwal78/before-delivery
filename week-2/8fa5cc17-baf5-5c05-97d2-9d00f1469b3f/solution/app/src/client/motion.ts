// Browser-side motion helpers: reduced motion, the Quire curve as CSS, and FLIP slides.
import { QUIRE_CURVE_CSS } from '../shared/motion.ts';

export { QUIRE_CURVE_CSS };

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = (): boolean => reduced.matches;

/** Element rectangles by key, read before a DOM change. */
export function measure(elements: Map<string, HTMLElement>): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  for (const [key, el] of elements) rects.set(key, el.getBoundingClientRect());
  return rects;
}

/**
 * Slides each element from its old place to its new one (FLIP). An element still sliding moves on
 * from where it is drawn, because the old rectangle was read with its running transform applied.
 */
export function flip(elements: Map<string, HTMLElement>, before: Map<string, DOMRect>, duration: number, fadeInMs?: number): void {
  for (const [key, el] of elements) {
    const old = before.get(key);
    if (!old) {
      if (fadeInMs && !reducedMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fadeInMs, easing: QUIRE_CURVE_CSS });
      continue;
    }
    for (const a of el.getAnimations()) if (a.id === 'flip') a.cancel();
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (reducedMotion() || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) continue;
    const anim = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration, easing: QUIRE_CURVE_CSS });
    anim.id = 'flip';
  }
}
