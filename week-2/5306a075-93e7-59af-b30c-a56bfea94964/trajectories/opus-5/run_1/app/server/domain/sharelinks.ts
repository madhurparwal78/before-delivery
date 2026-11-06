import type { ShareLinkStatus } from '../../shared/types';

/** The one definition of share-link activity. */

export const SHARE_LINK_MIN_SECONDS = 30;
export const SHARE_LINK_MAX_SECONDS = 31_536_000;
export const SHARE_LINK_TOKEN_BYTES = 32;

export interface ShareLinkTiming {
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export function shareLinkStatus(link: ShareLinkTiming, now: Date): ShareLinkStatus {
  if (link.revokedAt !== null) return 'revoked';
  if (link.expiresAt !== null && now.getTime() >= link.expiresAt.getTime()) return 'expired';
  return 'active';
}
