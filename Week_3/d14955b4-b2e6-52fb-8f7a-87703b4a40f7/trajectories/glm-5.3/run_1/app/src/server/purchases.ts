// The one refund-ledger decision.
import { query } from './db';

export interface PurchaseView {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: string;
  refunded_minor: number;
  status: 'paid' | 'partly_refunded' | 'refunded';
}

interface PurchaseRow {
  receipt_id: string;
  item: string;
  amount_minor: string;
  currency: string;
}

interface RefundSumRow {
  receipt_id: string;
  total: string | null;
}

export async function purchaseViews(gameId: string, receiptIds: string[] | null): Promise<PurchaseView[]> {
  if (receiptIds !== null && receiptIds.length === 0) return [];
  const filter = receiptIds === null ? '' : ' AND p.receipt_id = ANY($2)';
  const params: unknown[] = receiptIds === null ? [gameId] : [gameId, receiptIds];
  const purchases = await query<PurchaseRow>(`SELECT p.receipt_id, p.item, p.amount_minor, p.currency FROM purchases p WHERE p.game_id = $1${filter} ORDER BY p.created_at, p.receipt_id`, params as never[]);
  if (purchases.rows.length === 0) return [];
  const ids = purchases.rows.map((row) => row.receipt_id);
  const refunds = await query<RefundSumRow>(
    'SELECT r.receipt_id, SUM(r.amount_minor) AS total FROM refunds r WHERE r.game_id = $1 AND r.applied = true AND r.receipt_id = ANY($2) GROUP BY r.receipt_id',
    [gameId, ids],
  );
  const totals = new Map(refunds.rows.map((row) => [row.receipt_id, Number(row.total ?? 0)]));
  return purchases.rows.map((row) => {
    const amount = Number(row.amount_minor);
    const refunded = amount === 0 ? 0 : Math.min(amount, totals.get(row.receipt_id) ?? 0);
    const status: PurchaseView['status'] = amount === 0 || refunded === 0 ? 'paid' : refunded >= amount ? 'refunded' : 'partly_refunded';
    return { receipt_id: row.receipt_id, item: row.item, amount_minor: amount, currency: row.currency, refunded_minor: refunded, status };
  });
}

export async function threadPurchaseViews(gameId: string, receiptIds: string[]): Promise<PurchaseView[]> {
  return purchaseViews(gameId, receiptIds);
}

export async function refundsForReceipt(gameId: string, receiptId: string): Promise<number> {
  const result = await query<{ total: string | null }>(
    'SELECT SUM(amount_minor) AS total FROM refunds WHERE game_id = $1 AND receipt_id = $2 AND applied = true',
    [gameId, receiptId],
  );
  return Number(result.rows[0]?.total ?? 0);
}
