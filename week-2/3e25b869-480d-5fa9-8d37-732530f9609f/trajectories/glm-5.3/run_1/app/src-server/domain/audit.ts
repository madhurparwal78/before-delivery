// The finance audit: append-only, one entry per refund, credit, accepted
// reconciliation figure and orphan refund, written in the same unit as the action.
import type { PoolClient } from "pg";
import { money } from "../core/money.js";

export type AuditAction = "refund" | "credit" | "reconciliation_accept" | "orphan_refund";
export type AuditOutcome = "issued" | "failed";

export interface AuditActor {
  email: string;
  role: string;
}

export async function writeAudit(
  client: PoolClient,
  actor: AuditActor,
  action: AuditAction,
  target: string,
  reason: string,
  amountCents: number,
  killbillRef: string | null,
  outcome: AuditOutcome
): Promise<number> {
  const res = await client.query(
    `INSERT INTO audit_entries (actor, role, action, target, reason, amount, killbill_ref, outcome)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
    [actor.email, actor.role, action, target, reason, JSON.stringify(money(amountCents)), killbillRef, outcome]
  );
  return res.rows[0].id as number;
}
