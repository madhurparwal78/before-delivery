// Server enforcement of the permission table in shared/permissions.ts.
import { can, canInviteRole, type Action } from "../../shared/permissions.js";
import type { Caller } from "../auth.js";
import { forbidden } from "../errors.js";

export function authorize(caller: Caller, action: Action): void {
  if (!can(caller, action)) throw forbidden();
}

export function authorizeInvite(caller: Caller, role: string): void {
  if (!canInviteRole(caller, role)) throw forbidden();
}

/** Approving needs version.approve and is never allowed to the version's own creator. */
export function authorizeApproval(caller: Caller, creatorId: string): void {
  authorize(caller, "version.approve");
  if (caller.id === creatorId) throw forbidden();
}
