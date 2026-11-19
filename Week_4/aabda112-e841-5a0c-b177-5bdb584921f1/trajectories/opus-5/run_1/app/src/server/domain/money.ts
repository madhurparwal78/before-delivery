import { settings } from '../config';

function percentHalfUp(amountPence: number, percent: number): number {
  return Math.floor((amountPence * percent + 50) / 100);
}

export type LineAmounts = {
  netPence: number;
  discountPence: number;
  vatPence: number;
  totalPence: number;
};

/** The one place per-line money is worked out. */
export function lineAmounts(
  quantity: number,
  unitPricePence: number,
  discountPercent: number,
): LineAmounts {
  const netPence = quantity * unitPricePence;
  const discountPence = percentHalfUp(netPence, discountPercent);
  const vatPence = percentHalfUp(netPence - discountPence, settings.vatPercent);
  return { netPence, discountPence, vatPence, totalPence: netPence - discountPence + vatPence };
}

export function invoiceTotal(
  lines: { quantity: number; unitPricePence: number }[],
  discountPercent: number,
): number {
  return lines.reduce(
    (sum, line) => sum + lineAmounts(line.quantity, line.unitPricePence, discountPercent).totalPence,
    0,
  );
}
