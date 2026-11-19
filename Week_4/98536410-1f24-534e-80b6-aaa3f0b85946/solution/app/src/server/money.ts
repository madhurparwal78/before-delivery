// Money is integer cents; unit prices are integer thousandths of a euro. Every step rounds
// half-up once and never rounds a unit price first.

function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** quantity × unit price in thousandths, as whole cents. */
export function lineTotalCents(quantity: number, unitPriceMilli: number): number {
  return roundHalfUp(quantity * unitPriceMilli, 10);
}

/** The VAT inside a VAT-inclusive line total at the collecting shop's rate. */
export function vatCents(lineTotal: number, vatRate: number): number {
  return roundHalfUp(lineTotal * vatRate, 100 + vatRate);
}

/**
 * What a return of `quantity` units refunds. The return that brings a line's non-declined
 * returned quantity up to the full quantity refunds exactly what remains of the line total.
 */
export function refundCents(line: { quantity: number; unitPriceMilli: number; lineTotalCents: number },
  alreadyReturned: { quantity: number; refundCents: number }, quantity: number): number {
  if (alreadyReturned.quantity + quantity === line.quantity) return line.lineTotalCents - alreadyReturned.refundCents;
  return lineTotalCents(quantity, line.unitPriceMilli);
}
