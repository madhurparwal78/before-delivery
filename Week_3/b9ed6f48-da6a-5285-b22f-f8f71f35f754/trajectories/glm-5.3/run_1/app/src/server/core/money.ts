/** Money: integer minor units with a currency code, everywhere. */

export type Currency = 'EUR' | 'GBP' | 'USD' | 'JPY';
export const CURRENCIES: Currency[] = ['EUR', 'GBP', 'USD', 'JPY'];

export function isCurrency(v: unknown): v is Currency {
  return typeof v === 'string' && (CURRENCIES as string[]).includes(v);
}

export function minorDigits(currency: Currency): number {
  return currency === 'JPY' ? 0 : 2;
}

/** Format a minor-unit amount as €12.00 / £10.00 / $14.00 / ¥2,000. */
export function formatPrice(minor: number, currency: Currency): string {
  const sign = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '¥';
  if (currency === 'JPY') return `${sign}${withThousands(minor)}`;
  const major = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100);
  return `${sign}${withThousands(major)}.${String(cents).padStart(2, '0')}`;
}

function withThousands(n: number): string {
  const neg = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(n)));
  const groups: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  return neg + groups.join(',');
}

/** Kill Bill states amounts in major units. Convert minor -> major string. */
export function minorToMajorString(minor: number, currency: Currency): string {
  if (currency === 'JPY') return String(minor);
  const major = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100);
  return `${major}.${String(cents).padStart(2, '0')}`;
}

/** Parse a Kill Bill major-unit amount to minor units. */
export function majorToMinor(amount: number, currency: Currency): number {
  if (currency === 'JPY') return Math.round(amount);
  return Math.round(amount * 100);
}

/**
 * Parse an amount entered in major units ("25", "25.00", "12.5", "2000" for yen)
 * into minor units. Returns null when the text does not fit the format.
 */
export function parseAmountMinor(text: string, currency: Currency): number | null {
  const t = text.trim();
  if (currency === 'JPY') {
    if (!/^\d+$/.test(t)) return null;
    return Number(t);
  }
  const m = t.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return whole * 100 + frac;
}
