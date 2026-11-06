import type { Currency } from './markets.ts';

const DECIMALS: Record<Currency, number> = { DKK: 2, SEK: 2, EUR: 2, GBP: 2, USD: 2, JPY: 0 };

export function currencyDecimals(currency: Currency): number {
  return DECIMALS[currency];
}

/** `DKK 1,234.50`, `JPY 123,450`. */
export function formatMoney(minor: number, currency: Currency): string {
  return `${currency} ${formatAmount(minor, currency)}`;
}

/** The amount alone, in the money format without the code. */
export function formatAmount(minor: number, currency: Currency): string {
  const decimals = DECIMALS[currency];
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decimals === 0 ? grouped : `${grouped}.${fraction}`;
  return negative ? `-${body}` : body;
}

/** Parses an amount in the money format without its code into minor units. */
export function parseAmount(value: string, currency: Currency): number | null {
  const decimals = DECIMALS[currency];
  const trimmed = value.trim();
  const pattern = decimals === 0 ? /^\d{1,3}(,\d{3})*$|^\d+$/ : /^(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/;
  if (!pattern.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.replace(/,/g, '').split('.');
  if (decimals === 0 && fraction !== '') return null;
  return Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0') || '0');
}

/** Danish VAT at 25%, rounded half up on the amount given. */
export function danishVat(netMinor: number): number {
  return Math.floor((netMinor * 25 + 50) / 100);
}
