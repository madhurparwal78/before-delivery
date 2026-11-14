export type Role = "owner" | "editor" | "viewer";
export type MemberRole = "editor" | "viewer";
export type ShareAccess = "view" | "edit";
export type ShareStatus = "active" | "rotated" | "revoked" | "expired";
export type StoredShareStatus = "active" | "rotated" | "revoked";
export type AccessReason = "role_changed" | "removed" | "revoked" | "rotated" | "expired";

export type Permission = "read" | "write" | "manage";

/** The access matrix: who may read, write, or manage shares and members. */
export function denial(role: Role, permission: Permission): "read_only" | "owner_only" | null {
  if (permission === "read") return null;
  if (role === "viewer") return "read_only";
  if (permission === "manage" && role === "editor") return "owner_only";
  return null;
}

export function canEdit(role: Role): boolean {
  return denial(role, "write") === null;
}

export function canManage(role: Role): boolean {
  return denial(role, "manage") === null;
}

/** A share's status on the server clock: stored states are final, and an active share expires at its instant. */
export function shareStatus(stored: StoredShareStatus, expiresAt: Date, now: Date): ShareStatus {
  if (stored !== "active") return stored;
  return now.getTime() >= expiresAt.getTime() ? "expired" : "active";
}

export function memberRoleForAccess(access: ShareAccess): MemberRole {
  return access === "edit" ? "editor" : "viewer";
}
