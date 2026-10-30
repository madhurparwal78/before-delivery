import { many, one, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import { toUtcIso } from '../lib/time.js';
import { scanKerfTransactions } from '../services/killbill.js';

export type MismatchType =
  | 'unknown_in_app'
  | 'missing_in_killbill'
  | 'amount_mismatch'
  | 'status_mismatch';

export interface MismatchRow {
  id: string;
  run_id: string;
  type: MismatchType;
  order_ref: string | null;
  killbill_transaction_id: string | null;
  transaction_type: string;
  app_amount_cents: number | null;
  killbill_amount_cents: number | null;
  status: 'open' | 'resolved';
  note: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
}

export interface SerialisedMismatch {
  id: string;
  run_id: string;
  type: MismatchType;
  order_ref: string | null;
  killbill_transaction_id: string | null;
  transaction_type: string;
  app_amount_cents: number | null;
  killbill_amount_cents: number | null;
  status: 'open' | 'resolved';
  note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export function serialiseMismatch(row: MismatchRow): SerialisedMismatch {
  return {
    id: row.id,
    run_id: row.run_id,
    type: row.type,
    order_ref: row.order_ref,
    killbill_transaction_id: row.killbill_transaction_id,
    transaction_type: row.transaction_type,
    app_amount_cents: row.app_amount_cents,
    killbill_amount_cents: row.killbill_amount_cents,
    status: row.status,
    note: row.note,
    resolved_by: row.resolved_by,
    resolved_at: row.resolved_at === null ? null : toUtcIso(row.resolved_at),
  };
}

const MISMATCH_COLUMNS = `id, run_id, type, order_ref, killbill_transaction_id, transaction_type,
  app_amount_cents, killbill_amount_cents, status, note, resolved_by, resolved_at`;

export interface RunResult {
  id: string;
  started_at: string;
  finished_at: string;
  checked_transactions: number;
  mismatches: SerialisedMismatch[];
}

interface AppRecord {
  killbill_transaction_id: string | null;
  external_key: string;
  transaction_type: string;
  amount_cents: number;
  status: string;
  order_ref: string | null;
}

/** Compares every Kill Bill transaction on kerf- accounts with the app's own payment records. */
export async function runReconciliation(db: Queryable): Promise<RunResult> {
  const startedAt = new Date();
  const transactions = await scanKerfTransactions();
  const records = await many<AppRecord>(
    db,
    `SELECT pr.killbill_transaction_id, pr.external_key, pr.transaction_type, pr.amount_cents,
            pr.status, o.ref AS order_ref
     FROM payment_records pr LEFT JOIN orders o ON o.id = pr.order_id`,
  );

  const knownRefs = new Set(
    (await many<{ ref: string }>(db, `SELECT ref FROM orders`)).map((row) => row.ref),
  );
  const byTransactionId = new Map<string, AppRecord>();
  for (const record of records) {
    if (record.killbill_transaction_id !== null) {
      byTransactionId.set(record.killbill_transaction_id, record);
    }
  }

  const runId = newId();
  const found: Array<{
    type: MismatchType;
    orderRef: string | null;
    transactionId: string | null;
    transactionType: string;
    appAmount: number | null;
    killBillAmount: number | null;
    dedupeKey: string;
  }> = [];

  for (const transaction of transactions) {
    const record = byTransactionId.get(transaction.transactionId);
    const orderRef = knownRefs.has(transaction.paymentExternalKey)
      ? transaction.paymentExternalKey
      : null;
    if (record === undefined) {
      if (transaction.status !== 'SUCCESS') continue;
      found.push({
        type: 'unknown_in_app',
        orderRef,
        transactionId: transaction.transactionId,
        transactionType: transaction.transactionType,
        appAmount: null,
        killBillAmount: transaction.amountCents,
        dedupeKey: `unknown_in_app:${transaction.transactionId}`,
      });
      continue;
    }
    if (record.amount_cents !== transaction.amountCents) {
      found.push({
        type: 'amount_mismatch',
        orderRef: record.order_ref ?? orderRef,
        transactionId: transaction.transactionId,
        transactionType: transaction.transactionType,
        appAmount: record.amount_cents,
        killBillAmount: transaction.amountCents,
        dedupeKey: `amount_mismatch:${transaction.transactionId}`,
      });
    }
    if (record.status !== transaction.status) {
      found.push({
        type: 'status_mismatch',
        orderRef: record.order_ref ?? orderRef,
        transactionId: transaction.transactionId,
        transactionType: transaction.transactionType,
        appAmount: record.amount_cents,
        killBillAmount: transaction.amountCents,
        dedupeKey: `status_mismatch:${transaction.transactionId}`,
      });
    }
  }

  const killBillIds = new Set(transactions.map((transaction) => transaction.transactionId));
  for (const record of records) {
    if (record.killbill_transaction_id === null) continue;
    if (killBillIds.has(record.killbill_transaction_id)) continue;
    found.push({
      type: 'missing_in_killbill',
      orderRef: record.order_ref,
      transactionId: record.killbill_transaction_id,
      transactionType: record.transaction_type,
      appAmount: record.amount_cents,
      killBillAmount: null,
      dedupeKey: `missing_in_killbill:${record.killbill_transaction_id}`,
    });
  }

  const finishedAt = new Date();
  await db.query(
    `INSERT INTO reconciliation_runs (id, started_at, finished_at, checked_transactions)
     VALUES ($1, $2, $3, $4)`,
    [runId, startedAt, finishedAt, transactions.length],
  );

  const reported: MismatchRow[] = [];
  for (const candidate of found) {
    await db.query(
      `INSERT INTO mismatches (id, run_id, dedupe_key, type, order_ref, killbill_transaction_id,
         transaction_type, app_amount_cents, killbill_amount_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        newId(),
        runId,
        candidate.dedupeKey,
        candidate.type,
        candidate.orderRef,
        candidate.transactionId,
        candidate.transactionType,
        candidate.appAmount,
        candidate.killBillAmount,
      ],
    );
    const row = await one<MismatchRow>(
      db,
      `SELECT ${MISMATCH_COLUMNS} FROM mismatches WHERE dedupe_key = $1`,
      [candidate.dedupeKey],
    );
    if (row !== null) reported.push(row);
  }

  return {
    id: runId,
    started_at: toUtcIso(startedAt),
    finished_at: toUtcIso(finishedAt),
    checked_transactions: transactions.length,
    mismatches: reported.map(serialiseMismatch),
  };
}

export async function loadRun(db: Queryable, id: string): Promise<RunResult | null> {
  const run = await one<{
    id: string;
    started_at: Date;
    finished_at: Date;
    checked_transactions: number;
  }>(
    db,
    `SELECT id, started_at, finished_at, checked_transactions FROM reconciliation_runs
     WHERE id = $1`,
    [id],
  );
  if (run === null) return null;
  const rows = await many<MismatchRow>(
    db,
    `SELECT ${MISMATCH_COLUMNS} FROM mismatches WHERE run_id = $1 ORDER BY type`,
    [id],
  );
  return {
    id: run.id,
    started_at: toUtcIso(run.started_at),
    finished_at: toUtcIso(run.finished_at),
    checked_transactions: run.checked_transactions,
    mismatches: rows.map(serialiseMismatch),
  };
}

export async function listMismatches(
  db: Queryable,
  status: string | null,
): Promise<MismatchRow[]> {
  if (status === null) {
    return many<MismatchRow>(db, `SELECT ${MISMATCH_COLUMNS} FROM mismatches ORDER BY type`);
  }
  return many<MismatchRow>(
    db,
    `SELECT ${MISMATCH_COLUMNS} FROM mismatches WHERE status = $1 ORDER BY type`,
    [status],
  );
}

export async function loadMismatch(db: Queryable, id: string): Promise<MismatchRow | null> {
  return one<MismatchRow>(db, `SELECT ${MISMATCH_COLUMNS} FROM mismatches WHERE id = $1`, [id]);
}
