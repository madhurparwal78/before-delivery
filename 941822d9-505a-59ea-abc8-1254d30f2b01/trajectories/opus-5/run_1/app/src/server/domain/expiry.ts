/**
 * Every expiry comparison in the app is made here: the edge instant itself counts as
 * expired, so a request at or after `expiresAt` is too late.
 */
export function hasExpired(expiresAt: Date, at: Date): boolean {
  return at.getTime() >= expiresAt.getTime();
}

export type ShareLinkState = 'active' | 'revoked' | 'expired';

/**
 * A link that was not revoked before its expiry instant is listed as expired from then
 * on, never as revoked.
 */
export function shareLinkState(
  expiresAt: Date,
  revokedAt: Date | null,
  at: Date,
): ShareLinkState {
  if (revokedAt !== null && !hasExpired(expiresAt, revokedAt)) return 'revoked';
  if (hasExpired(expiresAt, at)) return 'expired';
  if (revokedAt !== null) return 'revoked';
  return 'active';
}

export function plusSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}
