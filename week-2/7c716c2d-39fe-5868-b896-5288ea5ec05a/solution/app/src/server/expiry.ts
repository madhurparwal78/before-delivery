// Knock and invite expiry: waiting/pending strictly before the edge, expired from the edge on.

export type KnockStatus = "waiting" | "let_in" | "not_now" | "expired";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export function knockStatus(stored: KnockStatus, expiresAt: number, now: number): KnockStatus {
  return stored === "waiting" && now >= expiresAt ? "expired" : stored;
}

export function inviteStatus(stored: InviteStatus, expiresAt: number, now: number): InviteStatus {
  return stored === "pending" && now >= expiresAt ? "expired" : stored;
}

/** SQL predicate for rows still waiting or pending at `$n` (the same edge as above). */
export function liveBefore(column: string, nowParam: string): string {
  return `${column} > ${nowParam}`;
}
