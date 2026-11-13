export const CURRENCIES = ['EUR', 'GBP', 'USD', 'JPY'] as const;

export type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<Currency, string> = { EUR: '€', GBP: '£', USD: '$', JPY: '¥' };
const DECIMALS: Record<Currency, number> = { EUR: 2, GBP: 2, USD: 2, JPY: 0 };

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** `<price>`: the currency symbol, comma thousands separators and the currency's decimals. */
export function formatPrice(amountMinor: number, currency: Currency): string {
  const decimals = DECIMALS[currency];
  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor).toString().padStart(decimals + 1, '0');
  const whole = absolute.slice(0, absolute.length - decimals) || '0';
  const fraction = decimals > 0 ? `.${absolute.slice(absolute.length - decimals)}` : '';
  return `${negative ? '-' : ''}${SYMBOLS[currency]}${groupThousands(whole)}${fraction}`;
}

/** Reads an amount field: major units, no sign, no separators. Returns minor units. */
export function parseAmountToMinor(input: string, currency: Currency): number | null {
  const text = input.trim();
  const decimals = DECIMALS[currency];
  if (decimals === 0) {
    if (!/^\d+$/.test(text)) return null;
    return Number(text);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Kill Bill states amounts in major units. */
export function minorToMajor(amountMinor: number, currency: Currency): string {
  const decimals = DECIMALS[currency];
  if (decimals === 0) return String(amountMinor);
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor).toString().padStart(decimals + 1, '0');
  return `${sign}${absolute.slice(0, absolute.length - decimals)}.${absolute.slice(absolute.length - decimals)}`;
}

export function majorToMinor(amountMajor: number, currency: Currency): number {
  return Math.round(amountMajor * (DECIMALS[currency] === 0 ? 1 : 100));
}
