import { randomBytes } from 'node:crypto';
import { Queryable, big, db } from '../db';

export type TopupStatus = 'pending' | 'paid' | 'failed';

export interface TopupRecord {
  id: string;
  teamId: string;
  credits: bigint;
  amountUsd: string;
  status: TopupStatus;
  pendingReason: string | null;
  failureReason: string | null;
  kbAccountId: string | null;
  kbInvoiceId: string | null;
  kbPaymentId: string | null;
  createdBy: string;
  createdAt: Date;
  paidAt: Date | null;
}

interface TopupDbRow {
  id: string;
  team_id: string;
  credits: string;
  amount_usd: string;
  status: string;
  pending_reason: string | null;
  failure_reason: string | null;
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  created_by: string;
  created_at: Date;
  paid_at: Date | null;
}

const COLUMNS = `id, team_id, credits, amount_usd, status, pending_reason, failure_reason, kb_account_id,
  kb_invoice_id, kb_payment_id, created_by, created_at, paid_at`;

function toTopup(row: TopupDbRow): TopupRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    credits: big(row.credits),
    amountUsd: row.amount_usd,
    status: row.status as TopupStatus,
    pendingReason: row.pending_reason,
    failureReason: row.failure_reason,
    kbAccountId: row.kb_account_id,
    kbInvoiceId: row.kb_invoice_id,
    kbPaymentId: row.kb_payment_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

/** `tu_` and 16 random lowercase hex characters, so ids never repeat across instances. */
export function newTopupId(): string {
  return `tu_${randomBytes(8).toString('hex')}`;
}

export async function insertTopup(input: {
  id: string;
  teamId: string;
  credits: bigint;
  amountUsd: string;
  createdBy: string;
}): Promise<TopupRecord> {
  const { rows } = await db.query<TopupDbRow>(
    `INSERT INTO topups (id, team_id, credits, amount_usd, status, created_by, created_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, now()) RETURNING ${COLUMNS}`,
    [input.id, input.teamId, input.credits.toString(), input.amountUsd, input.createdBy],
  );
  return toTopup(rows[0]!);
}

export async function topupById(id: string, client: Queryable = db): Promise<TopupRecord | null> {
  const { rows } = await client.query<TopupDbRow>(`SELECT ${COLUMNS} FROM topups WHERE id = $1`, [id]);
  return rows[0] ? toTopup(rows[0]) : null;
}

export async function topupsOfTeam(teamId: string): Promise<TopupRecord[]> {
  const { rows } = await db.query<TopupDbRow>(
    `SELECT ${COLUMNS} FROM topups WHERE team_id = $1 ORDER BY created_at DESC, id DESC`,
    [teamId],
  );
  return rows.map(toTopup);
}

/** Keeps a top-up pending; a late answer never pulls a paid top-up back to pending. */
export async function markPending(id: string, reason: string, nextRetryAt: Date): Promise<void> {
  await db.query(
    `UPDATE topups SET pending_reason = $2, next_retry_at = $3 WHERE id = $1 AND status = 'pending'`,
    [id, reason, nextRetryAt],
  );
}

export async function storeBillingIds(
  id: string,
  ids: { accountId?: string | null; invoiceId?: string | null; paymentId?: string | null },
): Promise<void> {
  await db.query(
    `UPDATE topups SET kb_account_id = COALESCE($2, kb_account_id), kb_invoice_id = COALESCE($3, kb_invoice_id),
       kb_payment_id = COALESCE($4, kb_payment_id) WHERE id = $1`,
    [id, ids.accountId ?? null, ids.invoiceId ?? null, ids.paymentId ?? null],
  );
}

export async function markFailed(id: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE topups SET status = 'failed', failure_reason = $2, pending_reason = NULL, next_retry_at = NULL
      WHERE id = $1 AND status = 'pending'`,
    [id, reason],
  );
}

/** Turns a top-up paid exactly once, so a retry never grants credits twice. */
export async function markPaidOnce(client: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE topups SET status = 'paid', pending_reason = NULL, next_retry_at = NULL, paid_at = now()
      WHERE id = $1 AND status <> 'paid'`,
    [id],
  );
  return rowCount > 0;
}

/** Claims a pending top-up for one retry, so instances sharing a database never work on it at once. */
export async function claimPendingTopup(id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE topups SET next_retry_at = now() + interval '30 seconds'
      WHERE id = $1 AND status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now())`,
    [id],
  );
  return rowCount > 0;
}

export async function pendingTopupsDue(): Promise<TopupRecord[]> {
  const { rows } = await db.query<TopupDbRow>(
    `SELECT ${COLUMNS} FROM topups WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY created_at`,
  );
  return rows.map(toTopup);
}
