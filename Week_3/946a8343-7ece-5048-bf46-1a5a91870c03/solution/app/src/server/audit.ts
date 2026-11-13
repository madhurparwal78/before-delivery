// Audit events: permanent, one per listed change, with before/after values (DP-39).
import type { Tx } from "./db.ts";
import { now } from "./clock.ts";

interface AuditEvent {
  readonly projectId?: number;
  readonly groupId?: number;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly before: object | null;
  readonly after: object | null;
}

export async function audit(tx: Tx, event: AuditEvent): Promise<void> {
  await tx.q(
    "INSERT INTO audit_events (project_id, group_id, actor, action, target, before, after, at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [event.projectId ?? null, event.groupId ?? null, event.actor, event.action, event.target, JSON.stringify(event.before), JSON.stringify(event.after), now()],
  );
}

export const SYSTEM_ACTOR = "system";
