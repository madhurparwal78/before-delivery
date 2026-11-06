// The audited actions, in the order the brief lists them (brief: Business rules, Audit trail).
export const AUDIT_ACTIONS = [
  "session.signed_in", "session.sign_in_failed", "password.changed", "two_step.enabled", "two_step.disabled",
  "member.role_changed", "member.removed", "invite.created", "invite.accepted", "access_key.created", "access_key.rotated",
  "access_key.disabled", "access_key.deleted", "legal_hold.changed", "encryption.rotated", "workspace.suspended",
  "workspace.reinstated", "permission.denied",
] as const;
