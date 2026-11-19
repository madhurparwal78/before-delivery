// Roles, invite states and expiry (brief: Roles and invites).
import type { InviteStatus, Role } from "./types";

export function canEdit(role: Role): boolean {
  return role === "owner" || role === "editor";
}

export function isOwner(role: Role): boolean {
  return role === "owner";
}

export function canResolve(role: Role, isAuthor: boolean): boolean {
  return canEdit(role) || isAuthor;
}

/** Invites and role changes name `editor` or `viewer`; the owner role never moves. */
export function isInvitableRole(role: unknown): role is "editor" | "viewer" {
  return role === "editor" || role === "viewer";
}

/** Stored invite states; `expired` is never stored, it is judged at every read. */
export type StoredInviteStatus = "emailed" | "email_not_sent" | "accepted" | "revoked";

/** The status an invite has right now on the server clock. */
export function inviteStatus<S extends StoredInviteStatus>(stored: S, sentAtMs: number, nowMs: number, ttlMs: number): S | "expired" {
  if (stored === "accepted" || stored === "revoked") return stored;
  return nowMs - sentAtMs >= ttlMs ? "expired" : stored;
}

export function isInviteOpen(status: StoredInviteStatus | "expired"): status is InviteStatus & ("emailed" | "email_not_sent") {
  return status === "emailed" || status === "email_not_sent";
}

/** Resend and revoke are allowed from emailed, email_not_sent and expired. */
export function isInviteClosed(status: StoredInviteStatus | "expired"): boolean {
  return status === "accepted" || status === "revoked";
}

export function inviteExpiresAt(sentAtMs: number, ttlMs: number): string {
  return new Date(sentAtMs + ttlMs).toISOString();
}
