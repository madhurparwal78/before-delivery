export type LinkState = 'active' | 'expired' | 'revoked';

export type LinkTimes = { expiresAtMs: number; revokedAtMs: number | null };

/** The one place an inspection link's state is decided, from the server's clock alone. */
export function linkState(link: LinkTimes, nowMs: number): LinkState {
  if (link.revokedAtMs !== null) return 'revoked';
  return nowMs < link.expiresAtMs ? 'active' : 'expired';
}
