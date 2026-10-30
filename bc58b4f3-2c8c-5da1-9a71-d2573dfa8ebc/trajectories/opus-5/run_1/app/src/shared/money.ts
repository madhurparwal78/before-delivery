/** `$1,343.00` from integer cents. */
export function formatDollars(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const fraction = String(Math.abs(cents) % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${grouped}.${fraction}`;
}

/** Decimal dollars for Kill Bill, built without floating-point arithmetic. */
export function dollarAmountLiteral(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
