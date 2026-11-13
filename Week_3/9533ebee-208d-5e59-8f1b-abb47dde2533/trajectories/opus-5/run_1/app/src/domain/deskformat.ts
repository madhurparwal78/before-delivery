/**
 * The desk formats: the single place where figures are written for and read
 * from people. Every screen, email, text statement and PDF uses these, and
 * the browser imports this same module rather than restating the rules.
 */

/** Narrow no-break space, the thousands separator. */
export const GROUP_SEPARATOR = '\u202F';
/** Minus sign, used for negative figures on screen. */
export const MINUS_SIGN = '\u2212';

/** Groups an integer digit string in threes, always, including four digits. */
function groupDigits(digits: string): string {
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += GROUP_SEPARATOR;
    out += digits[index];
  }
  return out;
}

function splitMinor(units: bigint, decimals: number): { integer: string; fraction: string } {
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = units % scale;
  return {
    integer: whole.toString(),
    fraction: decimals === 0 ? '' : fraction.toString().padStart(decimals, '0'),
  };
}

function compose(integer: string, fraction: string): string {
  return fraction === '' ? groupDigits(integer) : `${groupDigits(integer)},${fraction}`;
}

/**
 * An amount in the asset's own decimals: grouped integer part, a comma, then
 * exactly `decimals` digits. Negative amounts carry U+2212.
 */
export function formatAmount(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const { integer, fraction } = splitMinor(negative ? -units : units, decimals);
  return `${negative ? MINUS_SIGN : ''}${compose(integer, fraction)}`;
}

/** A statement leg: the same form, but a positive amount carries a `+`. */
export function formatSignedAmount(units: bigint, decimals: number): string {
  if (units < 0n) return formatAmount(units, decimals);
  return `+${formatAmount(units, decimals)}`;
}

/** A share count: a grouped integer with no decimals. */
export function formatShares(shares: bigint): string {
  const negative = shares < 0n;
  return `${negative ? MINUS_SIGN : ''}${groupDigits((negative ? -shares : shares).toString())}`;
}

/** A price in price units: `$` then the amount form with exactly 8 decimals. */
export function formatPrice(priceUnits: bigint): string {
  return `$${formatAmount(priceUnits, 8)}`;
}

/** The same price without `$`, as the New price field holds it. */
export function formatPriceForInput(priceUnits: bigint): string {
  return formatAmount(priceUnits, 8);
}

/** Basis points as a desk percentage: 1005 shows as `10,05%`. */
export function formatPercent(bps: bigint): string {
  return `${formatPercentPlain(bps)}%`;
}

/** Basis points without the `%`, as the risk textboxes hold them. */
export function formatPercentPlain(bps: bigint): string {
  return formatAmount(bps, 2);
}

/**
 * A health factor from its API form (4 decimals, or null with no debt).
 */
export function formatHealthFactor(apiValue: string | null): string {
  if (apiValue === null) return 'No debt';
  return apiValue.replace('.', ',');
}

/** A share price from its API form of exactly 12 decimals. */
export function formatSharePrice(apiValue: string): string {
  return apiValue.replace('.', ',');
}

/** A price from its API form of exactly 8 decimals. */
export function formatPriceFromApi(apiValue: string): string {
  return `$${compose(...apiPartsOf(apiValue))}`;
}

function apiPartsOf(apiValue: string): [string, string] {
  const [integer, fraction] = apiValue.split('.');
  return [integer ?? '0', fraction ?? ''];
}

/**
 * The shock in percent: U+2212 for negatives, `+` for positives, no sign at
 * zero, always one decimal.
 */
export function formatShock(shockPercentTenths: number): string {
  const whole = Math.trunc(Math.abs(shockPercentTenths) / 10);
  const tenth = Math.abs(shockPercentTenths) % 10;
  const sign = shockPercentTenths === 0 ? '' : shockPercentTenths < 0 ? MINUS_SIGN : '+';
  return `${sign}${groupDigits(String(whole))},${tenth}`;
}

/** A duration as `m:ss`. Minutes may exceed 59. */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.trunc(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Reading what the desk formats show
// ---------------------------------------------------------------------------

export type AmountProblem = 'shape' | 'decimals' | 'zero';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: AmountProblem };

const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Reads an amount field: digits, optional U+202F grouping placed exactly as
 * the display places it, and an optional comma with 1 up to `decimals`
 * digits. No sign, no point, and no leading zero except a single `0`.
 */
export function parseAmountInput(text: string, decimals: number): ParseResult<bigint> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'shape' };
  if (
    trimmed.includes('.') ||
    trimmed.includes('-') ||
    trimmed.includes(MINUS_SIGN) ||
    trimmed.includes('+')
  ) {
    return { ok: false, problem: 'shape' };
  }
  const commaCount = trimmed.split(',').length - 1;
  if (commaCount > 1) return { ok: false, problem: 'shape' };
  const [integerPart = '', fractionPart] = trimmed.split(',');

  const integerDigits = integerPart.split(GROUP_SEPARATOR).join('');
  if (!DIGITS_ONLY.test(integerDigits)) return { ok: false, problem: 'shape' };
  if (integerDigits.length > 1 && integerDigits.startsWith('0'))
    return { ok: false, problem: 'shape' };
  if (integerPart.includes(GROUP_SEPARATOR) && integerPart !== groupDigits(integerDigits)) {
    return { ok: false, problem: 'shape' };
  }

  if (fractionPart !== undefined) {
    if (!DIGITS_ONLY.test(fractionPart)) return { ok: false, problem: 'shape' };
    if (fractionPart.length > decimals) return { ok: false, problem: 'decimals' };
  }

  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(integerDigits) * scale;
  const fraction = fractionPart === undefined ? 0n : BigInt(fractionPart.padEnd(decimals, '0'));
  const units = whole + fraction;
  if (units === 0n) return { ok: false, problem: 'zero' };
  return { ok: true, value: units };
}

/**
 * Reads the New price field and returns the API form: digits, a point and
 * exactly the decimals typed, with no padding and no grouping. `56 000,5`
 * becomes `56000.5` and `52 000` becomes `52000`.
 */
export function parsePriceInput(text: string): ParseResult<string> {
  const withoutCurrency = text.trim().replace(/^\$\s*/, '');
  const parsed = parseAmountInput(withoutCurrency, 8);
  if (!parsed.ok) return parsed;
  const [integerPart = '', fractionPart] = withoutCurrency.trim().split(',');
  const integerDigits = integerPart.split(GROUP_SEPARATOR).join('');
  if (fractionPart === undefined || fractionPart === '') {
    return { ok: true, value: BigInt(integerDigits).toString() };
  }
  return { ok: true, value: `${BigInt(integerDigits).toString()}.${fractionPart}` };
}

/**
 * Reads a risk percentage field, such as `80,00`, into basis points. Zero is
 * allowed here: the bounds themselves are the server's to enforce.
 */
export function parsePercentInput(text: string): ParseResult<bigint> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'shape' };
  if (trimmed.includes('.') || trimmed.includes('%')) return { ok: false, problem: 'shape' };
  const commaCount = trimmed.split(',').length - 1;
  if (commaCount > 1) return { ok: false, problem: 'shape' };
  const [integerPart = '', fractionPart] = trimmed.split(',');
  const integerDigits = integerPart.split(GROUP_SEPARATOR).join('');
  if (!DIGITS_ONLY.test(integerDigits)) return { ok: false, problem: 'shape' };
  if (integerDigits.length > 1 && integerDigits.startsWith('0'))
    return { ok: false, problem: 'shape' };
  if (fractionPart !== undefined) {
    if (!DIGITS_ONLY.test(fractionPart)) return { ok: false, problem: 'shape' };
    if (fractionPart.length > 2) return { ok: false, problem: 'shape' };
  }
  const fraction = fractionPart === undefined ? 0n : BigInt(fractionPart.padEnd(2, '0'));
  return { ok: true, value: BigInt(integerDigits) * 100n + fraction };
}
