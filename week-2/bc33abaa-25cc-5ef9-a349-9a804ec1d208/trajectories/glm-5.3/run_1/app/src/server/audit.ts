import { pool } from "./db";
import type { Caller } from "./auth";

export type AuditAction =
  | "workspace.created"
  | "workspace.updated"
  | "member.invited"
  | "invite.revoked"
  | "member.joined"
  | "member.removed"
  | "token.issued"
  | "token.revoked"
  | "scene.created"
  | "scene.restored"
  | "asset.uploaded"
  | "comment.posted"
  | "comment.resolved"
  | "comment.reopened"
  | "version.saved"
  | "version.submitted"
  | "version.approved"
  | "version.scheduled"
  | "version.unscheduled"
  | "version.withdrawn"
  | "version.published"
  | "export.created"
  | "review_link.created"
  | "review_link.regenerated"
  | "review_link.revoked"
  | "subscription.started"
  | "subscription.plan_changed"
  | "subscription.seats_changed"
  | "subscription.cancelled"
  | "subscription.trial_ended"
  | "subscription.past_due"
  | "subscription.suspended"
  | "subscription.reactivated"
  | "invoice.paid"
  | "payment.refunded";

export function audit(
  caller: Caller,
  action: AuditAction,
  target: { type: string; id: string },
): void {
  const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
  const author =
    caller.kind === "agent"
      ? { kind: "agent" as const, id: caller.token.id, name: caller.token.name }
      : { kind: "member" as const, id: caller.member.id, name: caller.member.name };
  pool
    .query(
      "INSERT INTO audit (workspace_id, actor_kind, actor_id, actor_name, action, target_type, target_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [ws, author.kind, author.id, author.name, action, target.type, target.id],
    )
    .catch(() => {});
}

export function auditSystem(
  workspaceId: string,
  action: AuditAction,
  target: { type: string; id: string },
): void {
  pool
    .query(
      "INSERT INTO audit (workspace_id, actor_kind, actor_id, actor_name, action, target_type, target_id) VALUES ($1,'system','system','Orrery scheduler',$2,$3,$4)",
      [workspaceId, action, target.type, target.id],
    )
    .catch(() => {});
}
