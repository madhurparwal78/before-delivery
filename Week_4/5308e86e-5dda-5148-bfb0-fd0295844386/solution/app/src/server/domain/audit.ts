/** The hash-chained audit trail: one event per payment step, written in the transaction that makes the step. */
import { createHash } from "node:crypto";
import type { Tx } from "../db.js";
import { businessNow } from "../clock.js";

type AuditAction =
  | "payment.created"
  | "payment.approved"
  | "payment.posted"
  | "payment.rejected"
  | "payment.expired"
  | "payment.cancelled"
  | "payment.failed"
  | "transfer.posted"
  | "invoice.paid"
  | "loan.drawn";

const GENESIS_HASH = "0".repeat(64);

function eventHash(prevHash: string, seq: number, action: string, paymentId: string | null, amountCents: number, actorEmail: string): string {
  return createHash("sha256")
    .update(`${prevHash}|${seq}|${action}|${paymentId ?? ""}|${amountCents}|${actorEmail}`)
    .digest("hex");
}

export async function createAuditHead(tx: Tx, companyId: string): Promise<void> {
  await tx.query("INSERT INTO audit_heads (company_id, last_seq, last_hash) VALUES ($1, 0, $2)", [companyId, GENESIS_HASH]);
}

/** Appends one event. Takes the company's chain head last in every transaction, so chains never deadlock. */
export async function appendAudit(
  tx: Tx,
  companyId: string,
  action: AuditAction,
  paymentId: string | null,
  amountCents: number,
  actorEmail: string,
): Promise<void> {
  const head = await tx.query<{ last_seq: number; last_hash: string }>(
    "SELECT last_seq, last_hash FROM audit_heads WHERE company_id = $1 FOR UPDATE",
    [companyId],
  );
  const row = head.rows[0] as { last_seq: number; last_hash: string };
  const seq = row.last_seq + 1;
  const hash = eventHash(row.last_hash, seq, action, paymentId, amountCents, actorEmail);
  await tx.query(
    `INSERT INTO audit_events (company_id, seq, action, payment_id, amount_cents, actor_email, prev_hash, hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [companyId, seq, action, paymentId, amountCents, actorEmail, row.last_hash, hash, businessNow()],
  );
  await tx.query("UPDATE audit_heads SET last_seq = $2, last_hash = $3 WHERE company_id = $1", [companyId, seq, hash]);
}

export async function listAudit(tx: Tx, companyId: string) {
  const found = await tx.query(
    "SELECT seq, action, payment_id, amount_cents, actor_email, prev_hash, hash, created_at FROM audit_events WHERE company_id = $1 ORDER BY seq",
    [companyId],
  );
  return found.rows.map((row) => ({ ...row, created_at: (row.created_at as Date).toISOString() }));
}
