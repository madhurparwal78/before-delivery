import type { Currency, Part, Step } from './types.js';

const SYMBOL: Record<Currency, string> = { EUR: '€', GBP: '£', USD: '$', JPY: '¥' };
const DECIMALS: Record<Currency, number> = { EUR: 2, GBP: 2, USD: 2, JPY: 0 };

export const QUANTITY_MIN = 1;
export const QUANTITY_MAX = 999;
export const UNIT_PRICE_MIN = 0;
export const UNIT_PRICE_MAX = 99_999_999;

export function groupDigits(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** Cost text such as `€1,234.50` or `¥1,240`. */
export function formatCost(minor: number, currency: Currency): string {
  const decimals = DECIMALS[currency];
  const scale = decimals === 0 ? 1 : 100;
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / scale);
  const frac = abs - whole * scale;
  let text = groupDigits(String(whole));
  if (decimals > 0) text += '.' + String(frac).padStart(decimals, '0');
  return (negative ? '-' : '') + SYMBOL[currency] + text;
}

/** Signed cost text such as `+€4.90`, `-€0.50` or `+€0.00`, using a hyphen-minus. */
export function formatCostDifference(minor: number, currency: Currency): string {
  const sign = minor < 0 ? '-' : '+';
  return sign + formatCost(Math.abs(minor), currency);
}

/**
 * The running parts cost at a step: a part counts once, at the step it is
 * fitted new, so the figure is the sum over parts fitted at or before `number`.
 */
export function runningCost(parts: readonly Part[], steps: readonly Step[], number: number): number {
  const stepNumberById = new Map<string, number>();
  for (const step of steps) stepNumberById.set(step.id, step.number);
  let total = 0;
  for (const part of parts) {
    if (part.fitted_at === null) continue;
    const fittedNumber = stepNumberById.get(part.fitted_at);
    if (fittedNumber === undefined || fittedNumber > number) continue;
    total += part.quantity * part.unit_price;
  }
  return total;
}

/** The guide total is the running cost at the last step. */
export function guideTotal(parts: readonly Part[], steps: readonly Step[]): number {
  if (steps.length === 0) return 0;
  let last = 0;
  for (const step of steps) if (step.number > last) last = step.number;
  return runningCost(parts, steps, last);
}
