/**
 * Exact decimal money held as BigInt minor units (centavos).
 * Floating point never touches an amount.
 */
export type Currency = 'USD' | 'ARS';

export interface Amount {
  readonly currency: Currency;
  readonly minor: bigint;
}

export function amountFromMinor(currency: Currency, minor: bigint): Amount {
  return { currency, minor };
}

/** Parse a server amount string with exactly two decimals, e.g. "2350617.28". */
export function amountFromString(currency: Currency, value: string): Amount {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid amount string: ${value}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const minor = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  return { currency, minor: sign * minor };
}

/** Serialize to the API amount format: two decimals, no grouping. */
export function amountToString(amount: Amount): string {
  const negative = amount.minor < 0n;
  const abs = negative ? -amount.minor : amount.minor;
  const whole = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${cents}`;
}

/** The published display format. USD 1,999.99 or ARS 2.350.617,28. */
export function formatMoney(amount: Amount): string {
  const negative = amount.minor < 0n;
  const abs = negative ? -amount.minor : amount.minor;
  const whole = (abs / 100n).toString();
  const cents = (abs % 100n).toString().padStart(2, '0');
  let grouped: string;
  if (amount.currency === 'ARS') {
    grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  } else {
    grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const separator = amount.currency === 'ARS' ? ',' : '.';
  return `${negative ? '-' : ''}${amount.currency} ${grouped}${separator}${cents}`;
}

/** A share in percent, rounded half-up to one decimal, as a string like "40.0". */
export function sharePercent(part: bigint, whole: bigint): string {
  if (whole === 0n) return '0.0';
  const scaled = (part * 1000n + whole / 2n) / whole;
  const tenths = scaled / 10n;
  const remainder = scaled % 10n;
  return `${tenths.toString()}.${remainder.toString()}`;
}

export function addAmounts(a: Amount, b: Amount): Amount {
  if (a.currency !== b.currency) throw new Error('Currency mismatch');
  return { currency: a.currency, minor: a.minor + b.minor };
}

export function subAmounts(a: Amount, b: Amount): Amount {
  if (a.currency !== b.currency) throw new Error('Currency mismatch');
  return { currency: a.currency, minor: a.minor - b.minor };
}
