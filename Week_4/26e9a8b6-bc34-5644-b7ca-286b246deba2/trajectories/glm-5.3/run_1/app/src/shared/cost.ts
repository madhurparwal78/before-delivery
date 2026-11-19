export type CurrencyCode = 'EUR' | 'GBP' | 'USD' | 'JPY';

export const CURRENCIES: CurrencyCode[] = ['EUR', 'GBP', 'USD', 'JPY'];

interface CurrencySpec {
  symbol: string;
  symbolFirst: boolean;
  decimals: number;
}

const SPECS: Record<CurrencyCode, CurrencySpec> = {
  EUR: { symbol: '€', symbolFirst: true, decimals: 2 },
  GBP: { symbol: '£', symbolFirst: true, decimals: 2 },
  USD: { symbol: '$', symbolFirst: true, decimals: 2 },
  JPY: { symbol: '¥', symbolFirst: true, decimals: 0 },
};

function thousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Cost text in major units: symbol, thousands separators, two decimals (yen none). */
export function formatCost(minor: number, currency: CurrencyCode): string {
  const spec = SPECS[currency];
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const digits = String(abs);
  let body: string;
  if (spec.decimals === 0) {
    body = thousands(digits);
  } else {
    const units = digits.padStart(spec.decimals + 1, '0');
    const whole = units.slice(0, units.length - spec.decimals);
    const frac = units.slice(units.length - spec.decimals);
    body = `${thousands(whole)}.${frac}`;
  }
  const sign = negative ? '-' : '';
  return `${sign}${spec.symbol}${body}`;
}

/** Signed difference text, `+€0.00` when there is none. */
export function formatCostDifference(minor: number, currency: CurrencyCode): string {
  const sign = minor > 0 ? '+' : minor < 0 ? '-' : '+';
  return `${sign}${formatCost(Math.abs(minor), currency)}`;
}

export function isCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCIES as string[]).includes(value);
}
