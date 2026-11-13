/**
 * Money is integer cents everywhere. No floating-point arithmetic touches an amount:
 * every division goes through `divideHalfUp`.
 */

/** `numerator / denominator` as an integer, rounded half up. */
export function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** `€1,234.50` */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const units = Math.abs(cents);
  const whole = Math.floor(units / 100);
  const fraction = units % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}€${grouped}.${String(fraction).padStart(2, '0')}`;
}

/** `37.43` — the sales book's amount form: two decimals, a dot, no symbol, no grouping. */
export function formatAmountPlain(cents: number): string {
  const negative = cents < 0;
  const units = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(units / 100)}.${String(units % 100).padStart(2, '0')}`;
}

/** Euros as typed in a form (`49.90`, `49,90`, `49`) to integer cents. */
export function parseEuros(input: string): number | null {
  const trimmed = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.') as [string, string?];
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** `BE68 5390 0754 7034` */
export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
}
