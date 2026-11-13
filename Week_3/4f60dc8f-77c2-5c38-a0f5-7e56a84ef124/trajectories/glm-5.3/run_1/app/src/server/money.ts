export type CurrencyCode = 'EUR' | 'GBP' | 'USD' | 'JPY';

export interface CurrencyInfo {
  exponent: number;
  symbol: string;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  GBP: { exponent: 2, symbol: '£' },
  EUR: { exponent: 2, symbol: '€' },
  USD: { exponent: 2, symbol: '$' },
  JPY: { exponent: 0, symbol: '¥' },
};

export function isCurrency(code: string): code is CurrencyCode {
  return code === 'GBP' || code === 'EUR' || code === 'USD' || code === 'JPY';
}

/**
 * Exact decimal arithmetic on integers scaled by 10^scale.
 * A Decimal is [digits, scale]: value = digits / 10^scale.
 */
export type Decimal = { digits: bigint; scale: number };

export function decimalFromInt(value: number | bigint): Decimal {
  return { digits: BigInt(value), scale: 0 };
}

export function decimalFromIntegerString(text: string): Decimal | null {
  if (!/^-?\d+$/.test(text)) {
    return null;
  }
  return { digits: BigInt(text), scale: 0 };
}

/** Parse a decimal string like "1.1650", "0.0001", "1000", "44370" into exact Decimal. */
export function decimalFromString(text: string): Decimal | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const [whole, frac = ''] = trimmed.split('.');
  return { digits: BigInt(whole + frac), scale: frac.length };
}

export function decimalToString(value: Decimal, scale?: number): string {
  const target = scale ?? value.scale;
  let digits = value.digits;
  let current = value.scale;
  const sign = digits < 0n ? '-' : '';
  if (sign) {
    digits = -digits;
  }
  if (current < target) {
    digits = digits * 10n ** BigInt(target - current);
    current = target;
  }
  if (current > target) {
    // divide with truncation only when exactly divisible; caller controls rounding
    const factor = 10n ** BigInt(current - target);
    if (digits % factor !== 0n) {
      throw new Error('Cannot reduce scale losslessly');
    }
    digits = digits / factor;
    current = target;
  }
  const text = digits.toString().padStart(target + 1, '0');
  return sign + (target === 0 ? text : `${text.slice(0, -target)}.${text.slice(-target)}`);
}

/** Round half up to an integer (away from zero on .5). */
export function roundHalfUp(value: Decimal): bigint {
  if (value.scale === 0) {
    return value.digits;
  }
  const divisor = 10n ** BigInt(value.scale);
  const quotient = value.digits / divisor;
  const remainder = value.digits % divisor;
  const isNegative = value.digits < 0n;
  const absRemainder = isNegative ? -remainder : remainder;
  if (absRemainder * 2n >= divisor) {
    return isNegative ? quotient - 1n : quotient + 1n;
  }
  return quotient;
}

/** Truncating division at a fixed scale: value = (N/10^ns)/(D/10^ds). */
export function divideDecimal(numerator: Decimal, denominator: Decimal, scale: number): Decimal {
  const scaledNumerator = numerator.digits * 10n ** BigInt(denominator.scale + scale);
  const scaledDenominator = denominator.digits * 10n ** BigInt(numerator.scale);
  const negative = (numerator.digits < 0n) !== (denominator.digits < 0n);
  const absNum = scaledNumerator < 0n ? -scaledNumerator : scaledNumerator;
  const absDen = scaledDenominator < 0n ? -scaledDenominator : scaledDenominator;
  const quotient = absNum / absDen;
  return { digits: negative ? -quotient : quotient, scale };
}

/** Round-half-up division at a target scale. */
export function divideRoundHalfUp(numerator: Decimal, denominator: Decimal, scale: number): Decimal {
  const truncated = divideDecimal(numerator, denominator, scale + 1);
  const factor = 10n;
  const digit = truncated.digits % factor;
  const isNegative = truncated.digits < 0n;
  const absDigit = isNegative ? -digit : digit;
  let result = truncated.digits / factor;
  if (absDigit * 2n >= factor) {
    result = isNegative ? result - 1n : result + 1n;
  }
  return { digits: result, scale };
}

export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  return { digits: a.digits * b.digits, scale: a.scale + b.scale };
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return {
    digits: rescale(a, scale).digits + rescale(b, scale).digits,
    scale,
  };
}

export function subtractDecimal(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return {
    digits: rescale(a, scale).digits - rescale(b, scale).digits,
    scale,
  };
}

export function rescale(value: Decimal, scale: number): Decimal {
  if (value.scale === scale) {
    return value;
  }
  if (value.scale < scale) {
    return { digits: value.digits * 10n ** BigInt(scale - value.scale), scale };
  }
  const factor = 10n ** BigInt(value.scale - scale);
  if (value.digits % factor !== 0n) {
    throw new Error('Cannot rescale losslessly');
  }
  return { digits: value.digits / factor, scale };
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const left = rescale(a, scale).digits;
  const right = rescale(b, scale).digits;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Convert a GBP line amount to the account currency.
 * round_half_up(pence * rate * 10^exponent / 100)
 */
export function convertGbpMinor(pence: number | bigint, rate: string, currency: CurrencyCode): bigint {
  const penceDecimal = decimalFromInt(pence);
  const rateDecimal = decimalFromString(rate);
  if (rateDecimal === null) {
    throw new Error(`Invalid rate ${rate}`);
  }
  const exponent = CURRENCIES[currency].exponent;
  const multiplied = multiplyDecimal(penceDecimal, rateDecimal);
  const scaled = multiplyDecimal(multiplied, decimalFromInt(10n ** BigInt(exponent)));
  const divided = divideRoundHalfUp(scaled, decimalFromInt(100n), 0);
  return divided.digits;
}

/** VAT: 20% of the subtotal rounded half up to a whole minor unit. */
export function vatAmount(subtotalMinor: bigint, _currency: CurrencyCode): bigint {
  const subtotal = decimalFromInt(subtotalMinor);
  const vat = multiplyDecimal(subtotal, decimalFromString('0.2') as Decimal);
  return roundHalfUp(vat);
}

export interface MilestoneSplit {
  deposit: bigint;
  lookDev: bigint;
  finalDelivery: bigint;
}

/** Deposit 40% floor, look-dev 30% floor, final delivery remainder. */
export function milestoneSplit(totalMinor: bigint): MilestoneSplit {
  const total = decimalFromInt(totalMinor);
  const deposit = divideDecimal(multiplyDecimal(total, decimalFromInt(40n)), decimalFromInt(100n), 0).digits;
  const lookDev = divideDecimal(multiplyDecimal(total, decimalFromInt(30n)), decimalFromInt(100n), 0).digits;
  const finalDelivery = totalMinor - deposit - lookDev;
  return { deposit, lookDev, finalDelivery };
}

/** Format money in the display format: symbol, thousands separators, exponent decimals. */
export function formatMoney(minor: number | bigint, currency: CurrencyCode): string {
  const info = CURRENCIES[currency];
  const negative = minor < 0n || (typeof minor === 'number' && minor < 0);
  const value = typeof minor === 'number' ? BigInt(Math.round(minor)) : minor;
  const abs = value < 0n ? -value : value;
  let whole = abs;
  let fraction = '';
  if (info.exponent > 0) {
    const divisor = 10n ** BigInt(info.exponent);
    whole = abs / divisor;
    const frac = abs % divisor;
    fraction = '.' + frac.toString().padStart(info.exponent, '0');
  }
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${info.symbol}${wholeText}${fraction}`;
}

/** Format a GBP amount in minor units with the GBP display format. */
export function formatGbpMinor(pence: number | bigint): string {
  return formatMoney(pence, 'GBP');
}
