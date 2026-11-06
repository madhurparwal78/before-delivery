import { flavourName, provinceName } from '../../shared/catalogue.js';
import { formatDollars } from '../../shared/money.js';
import { taxLineLabel } from '../../shared/quote.js';
import type { RefundSplit } from '../../shared/refundSplit.js';
import type { OrderRecord } from '../db/orders.js';

export interface ReceiptRow {
  label: string;
  value: string;
}

/** The order's money rows, in the published breakdown order. */
export function receiptRows(order: OrderRecord): ReceiptRow[] {
  const rows: ReceiptRow[] = [{ label: 'Subtotal', value: formatDollars(order.goods_cents) }];
  if (order.discount_cents > 0) {
    rows.push({ label: 'Subscribe & save (10%)', value: formatDollars(-order.discount_cents) });
  }
  rows.push({ label: 'Deposit', value: formatDollars(order.deposit_cents) });
  rows.push({
    label: 'Shipping',
    value: order.shipping_cents === 0 ? 'Free' : formatDollars(order.shipping_cents),
  });
  for (const tax of order.taxes) {
    rows.push({ label: taxLineLabel(tax.name, tax.rate), value: formatDollars(tax.cents) });
  }
  rows.push({ label: 'Total', value: formatDollars(order.total_cents) });
  return rows;
}

export function lineRows(order: OrderRecord): ReceiptRow[] {
  return order.lines.map((line) => ({
    label: `${line.quantity} x ${flavourName(line.flavour)}`,
    value: formatDollars(line.goods_cents),
  }));
}

export function shipToLines(order: OrderRecord): string[] {
  const { ship_to: shipTo } = order;
  return [
    shipTo.name,
    shipTo.line1,
    ...(shipTo.line2 === '' ? [] : [shipTo.line2]),
    `${shipTo.city}, ${shipTo.province} ${shipTo.postal_code}`,
    provinceName(shipTo.province),
  ];
}

export function refundSplitRows(order: OrderRecord, split: RefundSplit): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  for (const line of split.lines) {
    rows.push({
      label: `${flavourName(line.flavour)} cans`,
      value: formatDollars(line.goods_cents),
    });
    rows.push({
      label: `${flavourName(line.flavour)} deposit`,
      value: formatDollars(line.deposit_cents),
    });
  }
  rows.push({ label: 'Shipping', value: formatDollars(split.shipping_cents) });
  for (const tax of split.taxes) {
    const rate = order.taxes.find((candidate) => candidate.name === tax.name)?.rate ?? '0.000';
    rows.push({ label: taxLineLabel(tax.name, rate), value: formatDollars(tax.cents) });
  }
  return rows;
}
