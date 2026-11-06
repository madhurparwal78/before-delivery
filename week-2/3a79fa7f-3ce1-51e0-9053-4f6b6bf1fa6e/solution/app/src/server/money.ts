// Integer cents only. Rounding works on integer numerators and denominators (adapted from kit/modules/money).

/** Exact integer division of non-negative integers. */
export function idiv(numerator: number, denominator: number): number {
  return (numerator - (numerator % denominator)) / denominator;
}

/** round_half_up(n / d) = floor(n / d + 1/2) for non-negative integers. */
export function roundHalfUp(numerator: number, denominator: number): number {
  return idiv(2 * numerator + denominator, 2 * denominator);
}

function dollarsAndCents(cents: number): [string, string] {
  return [String(idiv(cents, 100)), String(cents % 100).padStart(2, "0")];
}

/** `$X,XXX.XX`, for email bodies and subjects. */
export function formatPrice(cents: number): string {
  const [dollars, rest] = dollarsAndCents(cents);
  return `$${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${rest}`;
}

/** Dollars with two decimals as a JSON number literal for Kill Bill, without floating point. */
export function decimalDollars(cents: number): string {
  const [dollars, rest] = dollarsAndCents(cents);
  return `${dollars}.${rest}`;
}
