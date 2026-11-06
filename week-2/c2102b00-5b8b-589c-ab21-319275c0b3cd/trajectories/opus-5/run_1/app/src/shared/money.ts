/** Formats integer cents as dollars with thousands commas and two decimals, by digit arithmetic. */
export function formatDollars(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(fraction).padStart(2, '0')}`;
}

/** Formats integer cents as a plain decimal amount with no grouping, for provider payloads. */
export function plainDollars(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}
