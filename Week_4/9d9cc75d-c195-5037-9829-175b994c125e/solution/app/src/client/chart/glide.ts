// Mark Glide: one Web Animation per surviving mark, from its old box to its new box.
import type { Rect } from '../../shared/chart/types.ts';

const DURATION_MS = 240;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The element's box is its resting place; the animation starts displaced and scaled to `from` and ends on it. */
export function glide(element: SVGElement, from: Rect, to: Rect): void {
  for (const running of element.getAnimations()) {
    if (running.id === 'mark-glide') running.cancel();
  }
  const scaleX = to.width > 0 ? from.width / to.width : 1;
  const scaleY = to.height > 0 ? from.height / to.height : 1;
  element.animate(
    [
      { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${scaleX}, ${scaleY})` },
      { transform: 'translate(0px, 0px) scale(1, 1)' },
    ],
    { id: 'mark-glide', duration: DURATION_MS, easing: EASING },
  );
}
