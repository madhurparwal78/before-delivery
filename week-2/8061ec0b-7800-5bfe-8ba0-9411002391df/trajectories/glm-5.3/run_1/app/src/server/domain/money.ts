// Integer cents money math. The one rounding rule: round half up, once, per line.
export function roundDiv(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function sumCents(...parts: number[]): number {
  return parts.reduce((a, b) => a + b, 0);
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(frac).padStart(2, "0")}`;
}

export function formatTaxPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const frac = basisPoints % 100;
  return `${whole}.${String(frac).padStart(2, "0")}%`;
}
