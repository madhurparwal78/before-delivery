/** The one easing curve and the three published durations. */

export const DURATION_SHORT = 160;
export const DURATION_MEDIUM = 420;
export const DURATION_LONG = 640;

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Re-renders when the operating system's reduced-motion setting changes. */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listener = (): void => onChange(query.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
