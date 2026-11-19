import type { OfferStatus } from '../../shared/types';

export const isLive = (status: OfferStatus): boolean => status === 'open' || status === 'needs_reread';

/** An offer lapses on the server's clock, and at the exact instant it has lapsed. */
export const hasLapsed = (lapsesAt: Date, now: Date): boolean => now.getTime() >= lapsesAt.getTime();

/** Every read and action applies the lapse rule, whatever the stored status says. */
export const effectiveStatus = (stored: OfferStatus, lapsesAt: Date, now: Date): OfferStatus =>
  isLive(stored) && hasLapsed(lapsesAt, now) ? 'lapsed' : stored;

export const secondsRemaining = (lapsesAt: Date, now: Date, status: OfferStatus): number =>
  isLive(status) ? Math.max(0, Math.floor((lapsesAt.getTime() - now.getTime()) / 1000)) : 0;
