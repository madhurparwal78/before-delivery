/** Exact decimal money and quantity arithmetic. Values are scaled bigints; no floats. */

/** CHF amount, scaled by 100 (centimes). */
export type Money = bigint;
/** Decimal quantity, scaled by 100. */
export type Qty = bigint;

export const VAT_RATE_LABEL = '8.1';
/** VAT as the exact fraction 81/1000. */
const VAT_NUM = 81n;
const VAT_DEN = 1000n;

export const LABOUR_RATE: Money = 14500n;
export const LABOUR_RATE_LABEL = '145.00';

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  const q = n / denominator;
  const r = n % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function parseScaled(input: string, scale: number, maxDecimals: number): bigint | null {
  const text = input.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [whole = '', fraction = ''] = body.split('.');
  if (fraction.length > maxDecimals) return null;
  const padded = (fraction + '0'.repeat(scale)).slice(0, scale);
  const value = BigInt(whole + padded);
  return negative ? -value : value;
}

function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function parseMoney(input: string): Money | null {
  return parseScaled(input, 2, 2);
}

export function formatMoney(value: Money): string {
  return formatScaled(value, 2);
}

export function parseQty(input: string): Qty | null {
  return parseScaled(input, 2, 2);
}

export function formatQty(value: Qty): string {
  return formatScaled(value, 2);
}

/** Line net = quantity x unit price, rounded half up to 0.01. */
export function lineNet(quantity: Qty, unitPrice: Money): Money {
  return roundHalfUp(quantity * unitPrice, 100n);
}

/** Line VAT = line net x 8.1%, rounded half up to 0.01. */
export function lineVat(net: Money): Money {
  return roundHalfUp(net * VAT_NUM, VAT_DEN);
}

/** Rounds an amount half up to the nearest five centimes. */
export function roundToFiveCentimes(value: Money): Money {
  return roundHalfUp(value, 5n) * 5n;
}

export interface PricedLine {
  readonly quantity: Qty;
  readonly unitPrice: Money;
  readonly net: Money;
  readonly vat: Money;
}

export interface PricedTotals {
  readonly netTotal: Money;
  readonly vatTotal: Money;
  readonly rounding: Money;
  readonly total: Money;
}

export function priceLine(quantity: Qty, unitPrice: Money): PricedLine {
  const net = lineNet(quantity, unitPrice);
  return { quantity, unitPrice, net, vat: lineVat(net) };
}

export function totalsOf(lines: readonly PricedLine[]): PricedTotals {
  let netTotal = 0n;
  let vatTotal = 0n;
  for (const line of lines) {
    netTotal += line.net;
    vatTotal += line.vat;
  }
  const unrounded = netTotal + vatTotal;
  const total = roundToFiveCentimes(unrounded);
  return { netTotal, vatTotal, rounding: total - unrounded, total };
}
