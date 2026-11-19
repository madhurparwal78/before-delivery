/** Exact money: integer pence, one rounding at the stage the brief publishes (adapted from kit/modules/money). */

/** Round num/den to an integer, ties away from zero. Non-negative inputs only. */
function roundHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

interface LineMoney {
  netPence: number;
  discountPence: number;
  vatPence: number;
  totalPence: number;
}

/** Per line: discount is the invoice percent of net, VAT is the rate of (net - discount), each rounded half up. */
export function lineMoney(quantity: number, unitPricePence: number, discountPercent: number, vatPercent: number): LineMoney {
  const netPence = quantity * unitPricePence;
  const discountPence = roundHalfUp(netPence * discountPercent, 100);
  const vatPence = roundHalfUp((netPence - discountPence) * vatPercent, 100);
  return { netPence, discountPence, vatPence, totalPence: netPence - discountPence + vatPence };
}

export function formatPounds(pence: number): string {
  const whole = Math.trunc(pence / 100);
  return `£${whole.toLocaleString('en-GB')}.${String(pence % 100).padStart(2, '0')}`;
}
