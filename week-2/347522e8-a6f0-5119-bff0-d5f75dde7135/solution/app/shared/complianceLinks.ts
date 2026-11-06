// Compliance link liveness, defined once for the server's checks and the operator's link list.

/** A link is live while it is not revoked and the clock is strictly before its expiry instant. */
export function isLinkLive(revoked: boolean, expiresAt: number, at: number): boolean {
  return !revoked && at < expiresAt;
}
