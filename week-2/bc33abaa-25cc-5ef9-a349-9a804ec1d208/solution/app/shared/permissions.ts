// The permission table from Business rules. The server enforces it; the browser only uses it to hide links.
import type { Role, Scope } from "./api-types.js";

export type Action =
  | "scene.read" | "workspace.read" | "scene.create" | "asset.upload" | "scene.edit" | "presence"
  | "comment" | "version.manage" | "version.approve" | "member.invite" | "member.manage"
  | "workspace.settings" | "subscription.cancel" | "gateway.read" | "billing";

type Principal = { kind: "member"; role: Role } | { kind: "agent"; scope: Scope };

type Grant = { roles: readonly Role[]; scopes: readonly Scope[] };

const ALL_ROLES: readonly Role[] = ["owner", "admin", "billing_manager", "editor", "viewer"];

const TABLE: Record<Action, Grant> = {
  "scene.read": { roles: ALL_ROLES, scopes: ["read", "edit"] },
  "workspace.read": { roles: ALL_ROLES, scopes: [] },
  "scene.create": { roles: ["owner", "editor"], scopes: [] },
  "asset.upload": { roles: ["owner", "editor"], scopes: [] },
  "scene.edit": { roles: ["owner", "editor"], scopes: ["edit"] },
  // Presence heartbeats also come from members who only read a scene; they count for presence only.
  "presence": { roles: ALL_ROLES, scopes: ["edit"] },
  "comment": { roles: ALL_ROLES, scopes: [] },
  "version.manage": { roles: ["owner", "editor"], scopes: [] },
  "version.approve": { roles: ALL_ROLES, scopes: [] },
  "member.invite": { roles: ["owner", "admin", "billing_manager"], scopes: [] },
  "member.manage": { roles: ["owner", "admin"], scopes: [] },
  "workspace.settings": { roles: ["owner"], scopes: [] },
  "subscription.cancel": { roles: ["owner"], scopes: [] },
  "gateway.read": { roles: ["owner"], scopes: [] },
  "billing": { roles: ["owner", "billing_manager"], scopes: [] },
};

export function can(principal: Principal, action: Action): boolean {
  const grant = TABLE[action];
  return principal.kind === "member" ? grant.roles.includes(principal.role) : grant.scopes.includes(principal.scope);
}

/** Billing managers cannot invite admins. */
export function canInviteRole(principal: Principal, role: string): boolean {
  return can(principal, "member.invite") && !(principal.kind === "member" && principal.role === "billing_manager" && role === "admin");
}
