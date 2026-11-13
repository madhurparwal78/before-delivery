/** Every amount in this product is an integer number of øre. */

/** Rounding half up, written once, for the whole product. */
export function roundHalfUp(numerator: number, denominator: number): number {
  const scaled = (numerator * 2) / denominator;
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(scaled) + 1) / 2);
}

export function formatKroner(ore: number): string {
  const whole = Math.floor(Math.abs(ore) / 100);
  const fraction = Math.abs(ore) % 100;
  const grouped = whole.toLocaleString('en-US');
  return `${ore < 0 ? '-' : ''}${grouped}.${String(fraction).padStart(2, '0')}`;
}

/** Statement and certificate amounts put a minus before the currency. */
export function formatDkk(ore: number): string {
  return ore < 0 ? `-DKK ${formatKroner(-ore)}` : `DKK ${formatKroner(ore)}`;
}
