import { addCoopDays, coopDateOf, coopMidnight } from './time.js';

export type LicenceKind = 'exclusive' | 'standard';
export type LicenceState = 'pending_invoice' | 'active' | 'expired' | 'revoked';

export const HOLD_MINUTES = 30;
export const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;

/**
 * A window starts at confirmation and runs through the co-op date of the later of
 * confirmation and embargo lift plus `days - 1`, ending at the next co-op midnight.
 */
export function licenceWindowEnd(confirmedAt: Date, liftAt: Date, days: number): Date {
  const anchor = confirmedAt.getTime() >= liftAt.getTime() ? confirmedAt : liftAt;
  const throughDate = addCoopDays(coopDateOf(anchor), days - 1);
  return coopMidnight(addCoopDays(throughDate, 1));
}

/** Whichever is earlier: confirmation plus 30 minutes, or the window end. */
export function licenceHoldDeadline(confirmedAt: Date, windowEnd: Date): Date {
  const thirtyMinutes = new Date(confirmedAt.getTime() + HOLD_MINUTES * 60_000);
  return thirtyMinutes.getTime() <= windowEnd.getTime() ? thirtyMinutes : windowEnd;
}

/** A pending licence holds its window until its hold deadline; an active one until its window end. */
export function licenceEffectiveEnd(
  state: 'pending_invoice' | 'active',
  holdUntil: Date,
  windowEnd: Date,
): Date {
  return state === 'pending_invoice' ? holdUntil : windowEnd;
}

/** The state read from the server clock: an active licence is expired from its end instant. */
export function readLicenceState(
  storedState: LicenceState,
  windowEnd: Date,
  now: Date,
): LicenceState {
  if (storedState === 'active' && now.getTime() >= windowEnd.getTime()) return 'expired';
  return storedState;
}
