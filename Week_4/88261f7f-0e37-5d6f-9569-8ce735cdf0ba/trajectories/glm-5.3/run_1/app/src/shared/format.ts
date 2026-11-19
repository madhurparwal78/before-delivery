export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-$' : '$'}${dollars}.${frac}`;
}

export function halfUp(numerator: number, denominator: number): number {
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n % d;
  return sign * (r * 2 >= d ? q + 1 : q);
}
