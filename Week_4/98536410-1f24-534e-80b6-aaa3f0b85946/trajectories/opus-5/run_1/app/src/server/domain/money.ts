/** Half-up division of non-negative integers. */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Quantity times a unit price in thousandths of a euro, rounded once to the cent. */
export function lineTotalCents(quantity: number, unitPriceMilli: number): number {
  return divideHalfUp(quantity * unitPriceMilli, 10);
}

/** The value-added tax inside a VAT-inclusive line total, at the collecting shop's rate. */
export function vatCents(lineTotal: number, vatRate: number): number {
  return divideHalfUp(lineTotal * vatRate, 100 + vatRate);
}

/**
 * What a return of `quantity` units refunds. When the return brings the line's
 * non-declined returned quantity up to the full quantity it refunds what is left of
 * the line total, so unit roundings always add back up to the line.
 */
export function refundCents(
  quantity: number,
  unitPriceMilli: number,
  alreadyReturned: number,
  lineQuantity: number,
  lineTotal: number,
): number {
  if (alreadyReturned + quantity === lineQuantity) {
    return lineTotal - lineTotalCents(alreadyReturned, unitPriceMilli);
  }
  return lineTotalCents(quantity, unitPriceMilli);
}

/** Cents as euros with a comma decimal mark and the euro sign, for example `14,99 €`. */
export function formatAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, '0')} €`;
}
