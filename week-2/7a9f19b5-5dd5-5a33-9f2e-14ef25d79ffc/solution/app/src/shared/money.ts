// Money is integer cents without GST everywhere. This module is the only place GST is computed.

const GST_PERCENT = 15;

export interface Totals {
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
}

export function lineTotal(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}

/** GST is 15% of the subtotal, computed once per order, rounded to the nearest cent with halves up. */
export function orderTotals(lineTotals: readonly number[]): Totals {
  const subtotal = lineTotals.reduce((sum, cents) => sum + cents, 0);
  const gst = Math.floor((subtotal * GST_PERCENT + 50) / 100);
  return { subtotal_cents: subtotal, gst_cents: gst, total_cents: subtotal + gst };
}

/** `1234.5` dollars as cents 123450 → "1,234.50" (no dollar sign). */
function formatMoney(cents: number): string {
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+$)/g, ",");
  return `${whole}.${String(cents % 100).padStart(2, "0")}`;
}

export function dollars(cents: number): string {
  return `$${formatMoney(cents)}`;
}

/** Parses an admin amount field: dollars with up to two decimals and no dollar sign, e.g. "277.73". */
export function parseDollars(text: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim().replaceAll(",", ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export const MONEY_LABELS = {
  subtotal: "Subtotal (excl. GST)",
  gst: "GST (15%)",
  total: "Total (incl. GST)",
} as const;
