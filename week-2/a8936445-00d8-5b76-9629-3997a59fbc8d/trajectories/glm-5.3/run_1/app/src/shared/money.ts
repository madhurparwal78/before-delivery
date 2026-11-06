/** Integer-cent money and exact rounding. */

export const centsToDollars = (cents: number): string => (cents / 100).toFixed(2);

export const dollarsToCents = (dollars: string): number => Math.round(Number(dollars) * 100);

/** Half-up rounding of numerator/denominator to a whole number. */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("division by zero");
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** Exact cents for amount * percent / 100, rounded half up to a whole cent. */
export const percentOfCents = (amountCents: number, percent: number): number =>
  roundHalfUpDiv(amountCents * percent, 100);

/** Exact cents for minutes at an hourly rate, rounded half up to a whole cent. */
export const minutesAtHourlyRate = (minutes: number, hourlyRateCents: number): number =>
  roundHalfUpDiv(minutes * hourlyRateCents, 60);

/** Sales tax on a subtotal, rounded half up once. */
export const taxOfSubtotal = (subtotalCents: number, taxRatePercent: string): number => {
  const rateMilli = Math.round(Number.parseFloat(taxRatePercent) * 1000);
  return roundHalfUpDiv(subtotalCents * rateMilli, 100_000);
};
