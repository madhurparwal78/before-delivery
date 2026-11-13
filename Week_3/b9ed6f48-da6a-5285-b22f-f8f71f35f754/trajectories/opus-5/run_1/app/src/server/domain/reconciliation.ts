import { CURRENCIES, type Currency } from '../../shared/money.js';
import { lisbonMonthRange } from '../../shared/lisbon.js';
import { query } from '../db/index.js';
import type { ReconciliationRow } from '../../shared/types.js';
import { listRecordedAccounts } from './orders.js';
import { readAccountTransactions } from '../services/killbill.js';

/** Compares the ledger with Kill Bill, per currency, for one Lisbon month. */
export async function reconcile(monthKey: string): Promise<ReconciliationRow[]> {
  const range = lisbonMonthRange(monthKey);
  if (!range) return [];
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);

  const settled = await query<{ currency: Currency; total: string }>(
    `SELECT currency, COALESCE(SUM(amount_minor), 0)::text AS total FROM orders
     WHERE settled_at >= $1 AND settled_at < $2 GROUP BY currency`,
    [start, end],
  );
  const refunded = await query<{ currency: Currency; total: string }>(
    `SELECT o.currency, COALESCE(SUM(r.amount_minor), 0)::text AS total FROM refunds r
     JOIN orders o ON o.id = r.order_id
     WHERE r.at >= $1 AND r.at < $2 GROUP BY o.currency`,
    [start, end],
  );

  const ledger = new Map<Currency, number>();
  for (const row of settled) ledger.set(row.currency, (ledger.get(row.currency) ?? 0) + Number(row.total));
  for (const row of refunded) ledger.set(row.currency, (ledger.get(row.currency) ?? 0) - Number(row.total));

  const provider = new Map<Currency, number>();
  for (const accountId of await listRecordedAccounts()) {
    for (const transaction of await readAccountTransactions(accountId)) {
      if (transaction.effectiveDateMs < range.startMs || transaction.effectiveDateMs >= range.endMs) continue;
      const signed = transaction.type === 'PURCHASE' ? transaction.amountMinor : -transaction.amountMinor;
      provider.set(transaction.currency, (provider.get(transaction.currency) ?? 0) + signed);
    }
  }

  return CURRENCIES.map((currency) => {
    const ledgerNet = ledger.get(currency) ?? 0;
    const killbillNet = provider.get(currency) ?? 0;
    const difference = ledgerNet - killbillNet;
    return {
      currency,
      ledger_net_minor: ledgerNet,
      killbill_net_minor: killbillNet,
      difference_minor: difference,
      matched: difference === 0,
    };
  });
}
