// Top-ups through Kill Bill, with pending retries across outages.
import type { Pool } from "./db.js";
import { newTopUpId } from "./db.js";
import { ApiError } from "./jobs.js";
import { recordMovement, type MemberRow } from "./domain.js";
import type { KillBill } from "./killbill.js";
import { formatWholeCredits } from "../shared/money.js";

export interface TopUpRow {
  id: string;
  team_id: string;
  credits: number;
  amount_usd: string;
  status: "pending" | "paid" | "failed";
  pending_reason: string | null;
  failure_reason: string | null;
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  created_by: string;
  created_at: Date;
  paid_at: Date | null;
}

export function topupRow(r: Record<string, unknown>): TopUpRow {
  return {
    id: r.id as string,
    team_id: r.team_id as string,
    credits: Number(r.credits),
    amount_usd: r.amount_usd as string,
    status: r.status as TopUpRow["status"],
    pending_reason: (r.pending_reason as string | null) ?? null,
    failure_reason: (r.failure_reason as string | null) ?? null,
    kb_account_id: (r.kb_account_id as string | null) ?? null,
    kb_invoice_id: (r.kb_invoice_id as string | null) ?? null,
    kb_payment_id: (r.kb_payment_id as string | null) ?? null,
    created_by: r.created_by as string,
    created_at: r.created_at as Date,
    paid_at: (r.paid_at as Date | null) ?? null,
  };
}

export function validateCredits(credits: unknown): number {
  if (typeof credits !== "number" || !Number.isInteger(credits)) {
    throw new ApiError(422, "validation_failed", "Fix the highlighted fields.", { credits: "Enter a whole number of credits." });
  }
  if (credits < 100 || credits > 100_000 || credits % 100 !== 0) {
    throw new ApiError(422, "validation_failed", "Fix the highlighted fields.", {
      credits: "Enter a whole number from 100 to 100,000 in multiples of 100.",
    });
  }
  return credits;
}

export interface TopUpDeps {
  killbill: KillBill;
  onPaid(topup: TopUpRow): Promise<void>;
  billingUp(): Promise<boolean>;
}

/** Record a top-up: paid synchronously when Kill Bill answers, pending while it is down. */
export async function createTopUp(
  pool: Pool,
  deps: TopUpDeps,
  teamId: string,
  credits: number,
  requester: MemberRow,
): Promise<{ topup: TopUpRow; status: 201 | 202 }> {
  const team = await pool.one<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE id = $1`, [teamId]);
  if (!team) throw new ApiError(404, "not_found", "That team does not exist.");
  const id = newTopUpId();
  const amountUsd = (credits / 100).toFixed(2);
  await pool.exec(
    `INSERT INTO topups (id, team_id, credits, amount_usd, status, pending_reason, created_by)
     VALUES ($1,$2,$3,$4,'pending','billing_unavailable',$5)`,
    [id, teamId, credits, amountUsd, requester.id],
  );
  try {
    const result = await deps.killbill.recordTopUp(teamId, team.name, id, amountUsd);
    await markPaid(pool, deps, id, result.accountId, result.invoiceId, result.paymentId);
    const row = await pool.one<Record<string, unknown>>(`SELECT * FROM topups WHERE id = $1`, [id]);
    return { topup: topupRow(row as Record<string, unknown>), status: 201 };
  } catch (e) {
    if (e instanceof Error && e.constructor.name === "BillingRejectedError") {
      await pool.exec(
        `UPDATE topups SET status = 'failed', failure_reason = 'billing_rejected', pending_reason = NULL
         WHERE id = $1 AND status = 'pending'`,
        [id],
      );
      const row = await pool.one<Record<string, unknown>>(`SELECT * FROM topups WHERE id = $1`, [id]);
      return { topup: topupRow(row as Record<string, unknown>), status: 201 };
    }
    // Unreachable billing leaves the top-up pending; the retry loop completes it.
    const row = await pool.one<Record<string, unknown>>(`SELECT * FROM topups WHERE id = $1`, [id]);
    return { topup: topupRow(row as Record<string, unknown>), status: 202 };
  }
}

/** Complete a top-up: write the paired movement and email the receipt. */
async function markPaid(
  pool: Pool,
  deps: TopUpDeps,
  id: string,
  accountId: string,
  invoiceId: string,
  paymentId: string,
): Promise<void> {
  await pool.tx(async (tx) => {
    const row = await tx.one<{ status: string; credits: number; team_id: string }>(
      `SELECT status, credits, team_id FROM topups WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!row || row.status !== "pending") return;
    const amount = row.credits * 1_000_000;
    await recordMovement(tx, row.team_id, "top_up",
      { account: "funding", amountMicro: amount },
      { account: "available", amountMicro: amount },
      { topupId: id, kbInvoiceId: invoiceId });
    await tx.exec(
      `UPDATE topups SET status = 'paid', pending_reason = NULL, paid_at = now(),
       kb_account_id = $2, kb_invoice_id = $3, kb_payment_id = $4 WHERE id = $1`,
      [id, accountId, invoiceId, paymentId],
    );
  });
  const row = await pool.one<TopUpRow & { team_name: string }>(
    `SELECT t.*, tm.name AS team_name FROM topups t JOIN teams tm ON tm.id = t.team_id WHERE t.id = $1`,
    [id],
  );
  if (row) await deps.onPaid(row);
}

/** Retry every pending top-up; reuse what Kill Bill already holds. */
export async function retryPendingTopUps(pool: Pool, deps: TopUpDeps): Promise<void> {
  // Only top-ups whose synchronous attempt window has passed; younger ones
  // belong to the request that created them.
  const pending = await pool.many<Record<string, unknown>>(
    `SELECT t.*, tm.name AS team_name FROM topups t JOIN teams tm ON tm.id = t.team_id
     WHERE t.status = 'pending' AND t.created_at < now() - interval '30 seconds'
     ORDER BY t.created_at`,
  );
  for (const row of pending) {
    const topup = topupRow(row);
    const teamName = row.team_name as string;
    try {
      const result = await deps.killbill.recordTopUp(topup.team_id, teamName, topup.id, topup.amount_usd);
      await markPaid(pool, deps, topup.id, result.accountId, result.invoiceId, result.paymentId);
    } catch (e) {
      if (e instanceof Error && e.constructor.name === "BillingRejectedError") {
        await pool.exec(
          `UPDATE topups SET status = 'failed', failure_reason = 'billing_rejected', pending_reason = NULL
           WHERE id = $1 AND status = 'pending'`,
          [topup.id],
        );
      }
      // Unreachable billing leaves it pending for the next pass.
    }
  }
}

export { formatWholeCredits };
