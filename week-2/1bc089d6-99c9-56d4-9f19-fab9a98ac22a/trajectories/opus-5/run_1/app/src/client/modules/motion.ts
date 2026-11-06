const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const sideways = window.matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)');

export const prefersReducedMotion = (): boolean => reduced.matches;

/** Chapter four pins and travels sideways only on wide screens without reduced motion. */
export const prefersSidewaysChapter = (): boolean => sideways.matches;

export function onLayoutChange(listener: () => void): void {
  reduced.addEventListener('change', listener);
  sideways.addEventListener('change', listener);
}
