import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * After saving a new piece, completing a sale, placing a hold or starting a payout run the
 * address bar shows that record's route and focus lands on its level-1 heading.
 */
let wanted = false;

export function focusHeadingOnArrival(): void {
  wanted = true;
}

export function useArrivalFocus(
  heading: RefObject<HTMLHeadingElement>,
  ready: boolean,
): void {
  useEffect(() => {
    if (!ready || !wanted) return;
    wanted = false;
    heading.current?.focus();
  }, [ready, heading]);
}
