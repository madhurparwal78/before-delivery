import { useEffect, useState } from 'preact/hooks';

/** The product uses exactly three durations; the 160 ms press feedback is CSS alone. */
export const OVERLAY_MS = 320;
export const SWING_MS = 640;

/** Everything moves with a slight overshoot and then settles. */
export const OVERSHOOT = 'cubic-bezier(0.22, 1.4, 0.36, 1)';
export const SETTLE = 'cubic-bezier(0.4, 0, 0.2, 1)';

const query = (): MediaQueryList | null =>
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');

export function reducedMotion(): boolean {
  return query()?.matches === true;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reducedMotion);
  useEffect(() => {
    const list = query();
    if (list === null) return;
    const update = (): void => setReduced(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return reduced;
}
