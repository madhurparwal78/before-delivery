import type { LinkState } from '../../shared/types.js';

export const STALE_AFTER_S = 10;
export const LOST_AFTER_S = 60;

/**
 * The one link-state decision. It reads the age of the last received fix by the
 * server's clock; a fix's own `t` never affects it.
 */
export function decideLinkState(lastReceivedAt: Date | null, now: Date): LinkState {
  if (lastReceivedAt === null) return 'Lost';
  const ageSeconds = (now.getTime() - lastReceivedAt.getTime()) / 1000;
  if (ageSeconds < STALE_AFTER_S) return 'Live';
  if (ageSeconds <= LOST_AFTER_S) return 'Stale';
  return 'Lost';
}
