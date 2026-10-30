// Integer cents throughout. Dollars appear only as display strings and in the billing payload.
// Adapted from kit/modules/money (roundHalfUp).

/** The integer nearest num/den, ties away from zero; the brief's single rounding stage. */
export function roundHalfUp(num: number, den: number): number {
  const sign = num < 0 !== den < 0 ? -1 : 1;
  const n = Math.abs(num);
  const d = Math.abs(den);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** "$1,234.50" */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(cents) / 100).toLocaleString("en-US");
  return `${sign}$${whole}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/** "1234.50", as Kill Bill and the CSV take amounts. */
export function decimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/** Quarter-hours as hours with two decimals: 9 -> "2.25". */
export function hoursText(quarters: number): string {
  return `${Math.floor(quarters / 4)}.${String((quarters % 4) * 25).padStart(2, "0")}`;
}
