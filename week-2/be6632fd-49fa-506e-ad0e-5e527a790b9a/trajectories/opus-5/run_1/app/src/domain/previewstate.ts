export type PreviewLinkState = 'active' | 'revoked' | 'expired' | 'replaced' | 'drop_withdrawn';

export interface PreviewLinkFacts {
  revokedAtMs: number | null;
  replacedAtMs: number | null;
  expiresAtMs: number;
  dropWithdrawn: boolean;
  nowMs: number;
}

/** The state of a preview link, decided by the server's clock. */
export function previewLinkState(facts: PreviewLinkFacts): PreviewLinkState {
  if (facts.dropWithdrawn) return 'drop_withdrawn';
  if (facts.revokedAtMs !== null) return 'revoked';
  if (facts.replacedAtMs !== null) return 'replaced';
  if (facts.nowMs >= facts.expiresAtMs) return 'expired';
  return 'active';
}

export const DEAD_LINK_CODES: Record<Exclude<PreviewLinkState, 'active'>, string> = {
  revoked: 'link_revoked',
  expired: 'link_expired',
  replaced: 'link_replaced',
  drop_withdrawn: 'drop_withdrawn',
};

export const DEAD_LINK_COPY: Record<Exclude<PreviewLinkState, 'active'>, string> = {
  revoked: 'This preview link was revoked by the press team.',
  expired: 'This preview link has expired.',
  replaced: 'This preview link was replaced by a newer one. Check your inbox.',
  drop_withdrawn: 'This drop was withdrawn, so its preview is closed.',
};
