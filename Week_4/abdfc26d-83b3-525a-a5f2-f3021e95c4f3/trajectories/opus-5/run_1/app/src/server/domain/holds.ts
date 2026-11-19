import { config } from '../config.js';

/** A hold lasts HOLD_SECONDS from the moment the server grants it. */
export function holdExpiryFrom(grantedAt: Date): Date {
  return new Date(grantedAt.getTime() + config.holdSeconds * 1000);
}

/** At or after `expires_at` the hold counts as expired. */
export function isHoldExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export function secondsLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * The available number closest to the requested one, the lower number on a tie,
 * or null when none is left.
 */
export function nearestFreeEdition(
  requested: number,
  editionCount: number,
  takenNumbers: ReadonlySet<number>,
): number | null {
  for (let distance = 0; distance <= editionCount; distance += 1) {
    const lower = requested - distance;
    if (lower >= 1 && !takenNumbers.has(lower)) return lower;
    const higher = requested + distance;
    if (higher <= editionCount && !takenNumbers.has(higher)) return higher;
  }
  return null;
}
