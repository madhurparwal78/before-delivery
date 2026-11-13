import { randomUUID } from "node:crypto";
import { type SessionUser, requireRole, requireUser } from "./auth.js";
import { type Db, many, pool } from "./db.js";
import type { ApiRequest, ApiResult } from "./http.js";

// The director audit trail: one event per successful director write, written in that write's transaction.

type AuditAction = "program.create" | "program.update" | "category.create" | "juror.create" | "entry.pass"
  | "entry.disqualify" | "entry.reinstate" | "panel.add" | "round.open" | "round.close" | "round.confirm"
  | "category.publish";
type AuditTarget = "program" | "category" | "juror" | "entry" | "round";

export async function recordAudit(db: Db, action: AuditAction, targetType: AuditTarget, targetId: string,
  detail: Record<string, unknown> = {}): Promise<void> {
  await db.query("INSERT INTO audit_events (id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)",
    [randomUUID(), action, targetType, targetId, JSON.stringify(detail)]);
}

export async function listAudit(req: ApiRequest): Promise<ApiResult> {
  const user: SessionUser = await requireUser(req);
  requireRole(user, "director");
  const events = await many<{ id: string; action: string; target_type: string; target_id: string; at: Date; detail: unknown }>(
    pool, "SELECT id, action, target_type, target_id, at, detail FROM audit_events ORDER BY at DESC, seq DESC LIMIT 200");
  return {
    status: 200,
    json: {
      events: events.map((e) => ({
        id: e.id, action: e.action, targetType: e.target_type, targetId: e.target_id, at: e.at.toISOString(), detail: e.detail,
      })),
    },
  };
}
