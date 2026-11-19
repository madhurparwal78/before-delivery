import { useEffect, useState } from 'react';

/** The roll takes the Degree Roll token's duration; Message and Endorse arrive when the mutual line has settled. */
export const ROLL_MS = 480;
export const MUTUAL_FROM_MS = 280;
export const MUTUAL_MS = 320;
const ACTIONS_AT_MS = 600;
/** Starts fast and settles gently, and leaves the entering numeral well below rest at the halfway mark. */
export const ROLL_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * False for the first ACTIONS_AT_MS after the value changes, true otherwise (and always true under reduced motion).
 * Message and the Endorse buttons wait on it so they are not in the accessibility tree during the Degree Roll.
 */
export function useAfterRoll(value: string): boolean {
  const [state, setState] = useState({ value, open: true });
  if (state.value !== value) setState({ value, open: prefersReducedMotion() });
  useEffect(() => {
    if (state.open) return undefined;
    const timer = window.setTimeout(() => setState((current) => ({ ...current, open: true })), ACTIONS_AT_MS);
    return () => window.clearTimeout(timer);
  }, [state.value, state.open]);
  return state.open;
}
