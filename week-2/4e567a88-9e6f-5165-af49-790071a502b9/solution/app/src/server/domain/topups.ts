// Top-ups: credits reach the pool only after Kill Bill records the paid invoice. While billing is
// unreachable a top-up stays pending and grants nothing; a retry resumes it without a second invoice.

import { one, pool, rows, tx } from "../db";
import { MICRO, usdFor } from "../../shared/money";
import { BillingRejected, BillingUnavailable, recordTopup, type PaidTopup } from "../services/billing";
import { postMovement } from "./ledger";
import { mailReceipt } from "./notices";

interface TopupRow {
  number: bigint;
  id: string;
  team_id: string;
  team_name: string;
  credits: number;
  status: "pending" | "paid" | "failed";
  pending_reason: string | null;
  failure_reason: string | null;
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  created_by: string;
  creator_name: string;
  creator_email: string;
  created_at: Date;
  paid_at: Date | null;
}

const TOPUP_SELECT = `
  SELECT t.*, tm.name AS team_name, m.name AS creator_name, m.email AS creator_email
  FROM topups t JOIN teams tm ON tm.id = t.team_id JOIN members m ON m.id = t.created_by`;

export async function loadTopups(where: string, params: unknown[], tail = ""): Promise<TopupRow[]> {
  return rows<TopupRow>(pool, `${TOPUP_SELECT} WHERE ${where} ${tail}`, params);
}

export function projectTopup(t: TopupRow): Record<string, unknown> {
  return {
    id: t.id,
    team_id: t.team_id,
    credits: t.credits,
    amount_usd: usdFor(t.credits),
    status: t.status,
    pending_reason: t.pending_reason,
    failure_reason: t.failure_reason,
    kb_account_id: t.kb_account_id,
    kb_invoice_id: t.kb_invoice_id,
    kb_payment_id: t.kb_payment_id,
    created_by: { id: t.created_by, name: t.creator_name },
    created_at: t.created_at.toISOString(),
    paid_at: t.paid_at ? t.paid_at.toISOString() : null,
  };
}

const settling = new Set<string>();

async function saveProgress(id: string, ids: Partial<PaidTopup>): Promise<void> {
  await pool.query(
    `UPDATE topups SET kb_account_id = COALESCE($2, kb_account_id), kb_invoice_id = COALESCE($3, kb_invoice_id),
       kb_payment_id = COALESCE($4, kb_payment_id) WHERE id = $1`,
    [id, ids.accountId ?? null, ids.invoiceId ?? null, ids.paymentId ?? null]);
}

/** Tries Kill Bill once for a pending top-up and records the outcome; returns the stored row. */
export async function completeTopup(id: string): Promise<TopupRow> {
  if (settling.has(id)) return (await loadTopups("t.id = $1", [id]))[0];
  settling.add(id);
  try {
    const [topup] = await loadTopups("t.id = $1", [id]);
    let paid: PaidTopup;
    try {
      paid = await recordTopup(
        { id, team_id: topup.team_id, team_name: topup.team_name, amount_usd: usdFor(topup.credits) },
        (ids) => saveProgress(id, ids));
    } catch (error) {
      if (error instanceof BillingUnavailable) {
        await pool.query("UPDATE topups SET pending_reason = 'billing_unavailable' WHERE id = $1 AND status = 'pending'", [id]);
      } else if (error instanceof BillingRejected) {
        await pool.query(
          "UPDATE topups SET status = 'failed', pending_reason = NULL, failure_reason = 'billing_rejected' WHERE id = $1 AND status = 'pending'", [id]);
      } else {
        throw error;
      }
      return (await loadTopups("t.id = $1", [id]))[0];
    }
    const granted = await tx(async (client) => {
      const pending = await one<{ status: string }>(client, "SELECT status FROM topups WHERE id = $1 FOR UPDATE", [id]);
      if (pending?.status !== "pending") return false;
      const now = new Date();
      await client.query(
        `UPDATE topups SET status = 'paid', pending_reason = NULL, kb_account_id = $2, kb_invoice_id = $3, kb_payment_id = $4,
           paid_at = $5 WHERE id = $1`, [id, paid.accountId, paid.invoiceId, paid.paymentId, now]);
      await postMovement(client, {
        teamId: topup.team_id, kind: "top_up", amount: BigInt(topup.credits) * MICRO, at: now, topupId: id, kbInvoiceId: paid.invoiceId,
      });
      return true;
    });
    if (granted) mailReceipt(topup.creator_email, topup.team_name, topup.credits, usdFor(topup.credits), paid.invoiceId);
    return (await loadTopups("t.id = $1", [id]))[0];
  } finally {
    settling.delete(id);
  }
}
