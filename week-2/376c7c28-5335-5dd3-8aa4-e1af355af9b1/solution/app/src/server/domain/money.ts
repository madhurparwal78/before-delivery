/** Money is integer cents everywhere. These helpers never use floating point for it. */

export function formatDollars(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const part = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(part).padStart(2, '0')}`;
}

/** "$5.20", and "-$5.20" for a negative balance. */
export function signedDollarLabel(cents: number): string {
  return cents < 0 ? `-$${formatDollars(-cents)}` : `$${formatDollars(cents)}`;
}

/** Positive dollars with two decimals and no sign, for statement cells. */
export function plainDollars(cents: number): string {
  return formatDollars(Math.abs(cents));
}
