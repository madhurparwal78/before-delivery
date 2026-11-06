// Regulator link status, decided from one read of the server clock.

export interface RegulatorLink {
  id: string;
  figure_id: string;
  token: string;
  issued_at: number;
  expires_at: number;
  revoked_at: number | null;
}

type LinkStatus = "live" | "expired" | "revoked";

/** Revoked if revoked; otherwise expired from the expiry second onward; otherwise live. */
export function linkStatus(link: RegulatorLink, now: number): LinkStatus {
  if (link.revoked_at !== null) return "revoked";
  return now >= link.expires_at ? "expired" : "live";
}

/** Why a revoke is refused: at or after expiry it is expired (even if revoked earlier), else a second revoke. */
export function revokeRefusal(link: RegulatorLink, now: number): "link_expired" | "link_revoked" | null {
  if (now >= link.expires_at) return "link_expired";
  return link.revoked_at !== null ? "link_revoked" : null;
}
