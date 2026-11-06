/**
 * The one GST calculation. Stored and displayed prices are always without GST;
 * GST is 15% of the subtotal, computed once per order, halves rounded up.
 */

export const GST_RATE_PERCENT = 15;

export const MONEY_LABELS = {
  subtotal: "Subtotal (excl. GST)",
  gst: "GST (15%)",
  total: "Total (incl. GST)",
} as const;

/** The description of the single GST item on a Kill Bill trade invoice. */
export const GST_INVOICE_ITEM_DESCRIPTION = "GST 15%";

export interface Totals {
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
}

export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}

/** Halves round up, which `Math.round` already does for the positive amounts money takes. */
export function gstCents(subtotalCents: number): number {
  return Math.round((subtotalCents * GST_RATE_PERCENT) / 100);
}

export function totalsFor(lines: ReadonlyArray<{ unit_price_cents: number; quantity: number }>): Totals {
  const subtotal = lines.reduce((sum, line) => sum + lineTotalCents(line.unit_price_cents, line.quantity), 0);
  const gst = gstCents(subtotal);
  return { subtotal_cents: subtotal, gst_cents: gst, total_cents: subtotal + gst };
}
