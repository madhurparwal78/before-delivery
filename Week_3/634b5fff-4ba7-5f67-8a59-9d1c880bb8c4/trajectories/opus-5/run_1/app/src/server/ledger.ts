import { query } from './db.js';
import { gatewayFeeOre } from './domain.js';
import type { OrderRow } from './orders.js';
import * as killbill from './services/killbill.js';

export interface LedgerLine {
  kind: 'sale' | 'refund';
  grossOre: number;
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
  settledAt: string;
}

export interface LedgerView {
  reference: string;
  rateBasisPoints: number;
  grossOre: number;
  courierOre: number;
  totalOre: number;
  lines: LedgerLine[];
  totals: { grossOre: number; netOre: number; vatOre: number; charityOre: number; makerOre: number };
  gatewayFeeOre: number;
  makerAfterFeesOre: number;
  refunds: { refundId: string; state: string; amountOre: number }[];
  killbill: {
    invoiceId: string;
    items: { description: string; amountOre: number }[];
    transactions: { type: string; amountOre: number }[];
  } | null;
}

/** Stored split lines are the ledger's own record; only settled refunds show. */
export async function ledgerFor(order: OrderRow): Promise<LedgerView> {
  const lineRows = await query<{
    kind: 'sale' | 'refund';
    gross_ore: number;
    net_ore: number;
    vat_ore: number;
    charity_ore: number;
    maker_ore: number;
    posted_at: Date;
  }>(
    `SELECT kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore, posted_at
       FROM split_lines WHERE reference = $1 ORDER BY posted_at, id`,
    [order.reference],
  );
  const lines: LedgerLine[] = lineRows.map((row) => ({
    kind: row.kind,
    grossOre: row.gross_ore,
    netOre: row.net_ore,
    vatOre: row.vat_ore,
    charityOre: row.charity_ore,
    makerOre: row.maker_ore,
    settledAt: row.posted_at.toISOString(),
  }));
  const totals = lines.reduce(
    (sum, line) => ({
      grossOre: sum.grossOre + line.grossOre,
      netOre: sum.netOre + line.netOre,
      vatOre: sum.vatOre + line.vatOre,
      charityOre: sum.charityOre + line.charityOre,
      makerOre: sum.makerOre + line.makerOre,
    }),
    { grossOre: 0, netOre: 0, vatOre: 0, charityOre: 0, makerOre: 0 },
  );

  const refundRows = await query<{ refund_id: string; state: string; amount_ore: number }>(
    'SELECT refund_id, state, amount_ore FROM refunds WHERE reference = $1 ORDER BY created_at',
    [order.reference],
  );

  const feeOre = order.paid_at === null ? 0 : gatewayFeeOre(order.method);

  let ledger: LedgerView['killbill'] = null;
  if (order.killbill_invoice_id !== null) {
    try {
      ledger = {
        invoiceId: order.killbill_invoice_id,
        items: await killbill.invoiceItems(order.killbill_invoice_id),
        transactions: await killbill.transactionsFor(order.reference),
      };
    } catch {
      ledger = null;
    }
  }

  return {
    reference: order.reference,
    rateBasisPoints: order.rate_basis_points,
    grossOre: order.gross_ore,
    courierOre: order.courier_ore,
    totalOre: order.total_ore,
    lines,
    totals,
    gatewayFeeOre: feeOre,
    makerAfterFeesOre: totals.makerOre - feeOre,
    refunds: refundRows.map((row) => ({
      refundId: row.refund_id,
      state: row.state,
      amountOre: row.amount_ore,
    })),
    killbill: ledger,
  };
}
