import { KITCHEN } from './constants.js';
import { roundHalfUp } from './money.js';
import type { InvoiceLineRecord } from './types.js';

export interface InvoiceTotals {
  subtotalCents: number;
  taxRatePercent: string;
  taxCents: number;
  totalCents: number;
}

/** Tax is taken once, on the subtotal, rounded half up to a whole cent. */
export function invoiceTotals(lines: readonly InvoiceLineRecord[]): InvoiceTotals {
  const subtotalCents = lines.reduce((total, line) => total + line.amountCents, 0);
  const rate = Number.parseFloat(KITCHEN.salesTaxRatePercent);
  const taxCents = roundHalfUp((subtotalCents * rate) / 100);
  return {
    subtotalCents,
    taxRatePercent: KITCHEN.salesTaxRatePercent,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}
