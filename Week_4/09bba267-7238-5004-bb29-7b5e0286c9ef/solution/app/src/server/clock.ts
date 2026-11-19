// Time rules, decided on the server clock only: hold and offer expiry, the sales close and the change cutoff.

const CHANGE_CUTOFF_MS = 24 * 60 * 60 * 1000;

/** An expiry instant: now plus an absolute duration, on a whole second so the API shows the exact instant. */
export function expiryFrom(now: Date, seconds: number): Date {
  return new Date(Math.floor((now.getTime() + seconds * 1000) / 1000) * 1000);
}

/** A hold or an offer has ended from its expiry instant on. */
export function hasExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export function secondsLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

/** Sales (holds, checkout, waitlist joins, offer acceptance) are open strictly before the start instant. */
export function salesOpen(startsAt: Date, now: Date): boolean {
  return now.getTime() < startsAt.getTime();
}

/** Exchanges and refunds are open strictly before 24 hours ahead of the start instant. */
export function changesOpen(startsAt: Date, now: Date): boolean {
  return now.getTime() < startsAt.getTime() - CHANGE_CUTOFF_MS;
}

/** An open offer ends at its expiry instant, or when sales close. */
export function offerEnded(expiresAt: Date, startsAt: Date, now: Date): boolean {
  return hasExpired(expiresAt, now) || !salesOpen(startsAt, now);
}

/** `2027-11-07T06:30:00Z` */
export function isoInstant(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}
