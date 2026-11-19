export const LINK_MAX_SECONDS = 31_536_000;

export type LinkStatus = 'active' | 'expired' | 'revoked';

/** Revoked beats expired. */
export function linkStatus(
  input: { expires_at: Date; revoked_at: Date | null },
  now: Date,
): LinkStatus {
  if (input.revoked_at !== null) return 'revoked';
  if (input.expires_at.getTime() <= now.getTime()) return 'expired';
  return 'active';
}
