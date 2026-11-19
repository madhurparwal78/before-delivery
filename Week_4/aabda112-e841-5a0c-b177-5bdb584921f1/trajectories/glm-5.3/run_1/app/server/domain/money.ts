import { settings } from '../settings.js';

// The one place that decides money. All amounts are integer pence.
const roundHalfUp = (pence: number): number => Math.floor(pence + 0.5);

export function lineAmounts(quantity: number, unitPricePence: number, discountPercent: number) {
  const net = quantity * unitPricePence;
  const discount = roundHalfUp((net * discountPercent) / 100);
  const vat = roundHalfUp(((net - discount) * settings.vatPercent) / 100);
  const total = net - discount + vat;
  return { net, discount, vat, total };
}

export function invoiceTotals(lines: { totalPence: number }[]) {
  return lines.reduce((sum, l) => sum + l.totalPence, 0);
}

export function formatPence(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(Math.round(pence));
  return `${sign}£${Math.floor(abs / 100).toLocaleString('en-GB')}.${String(abs % 100).padStart(2, '0')}`;
}
