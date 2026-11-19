/** Money is integer cents end to end; no floating point touches money or prices. */

export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${remainder.toString().padStart(2, '0')}`;
}

export function formatInteger(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The fee for one fill: half-up rounding, applied per fill, never per order. */
export function feeForNotional(notionalCents: number, bps: number): number {
  return Math.floor((notionalCents * bps + 5000) / 10000);
}
