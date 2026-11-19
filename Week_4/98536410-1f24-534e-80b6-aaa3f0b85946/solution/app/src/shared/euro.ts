/** Euros with two decimals: a comma, no thousands separator, an ordinary space and the euro sign. */
export function formatEuro(cents: number): string {
  const whole = Math.trunc(cents / 100);
  return `${whole},${String(Math.abs(cents % 100)).padStart(2, "0")} €`;
}
