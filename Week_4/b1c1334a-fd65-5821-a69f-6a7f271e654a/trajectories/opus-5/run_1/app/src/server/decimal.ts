/**
 * Exact decimal arithmetic. A decimal is an unscaled integer and a scale, so no
 * value ever passes through a binary floating-point number.
 */
export type Dec = { readonly u: bigint; readonly s: number };

const DIV_SCALE = 30;
export const DISPLAY_SCALE = 4;
export const MAX_INT_DIGITS = 15;

const POW10: bigint[] = [];
function pow10(n: number): bigint {
  const cached = POW10[n];
  if (cached !== undefined) return cached;
  const value = 10n ** BigInt(n);
  POW10[n] = value;
  return value;
}

export function dec(u: bigint, s: number): Dec {
  return { u, s };
}

export const ZERO: Dec = dec(0n, 0);

/** Reads the exact decimal characters `-?digits[.digits]`. */
export function parseDecimalText(text: string): Dec | null {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(text);
  if (!match) return null;
  const [, sign = '', intPart = '', fracPart = ''] = match;
  const significantInt = intPart.replace(/^0+(?=[0-9])/, '');
  if (significantInt.length > MAX_INT_DIGITS) return null;
  const digits = `${significantInt}${fracPart}`;
  const u = BigInt(digits) * (sign === '-' ? -1n : 1n);
  return dec(u, fracPart.length);
}

function rescale(a: Dec, scale: number): bigint {
  return a.u * pow10(scale - a.s);
}

function align(a: Dec, b: Dec): { scale: number; au: bigint; bu: bigint } {
  const scale = Math.max(a.s, b.s);
  return { scale, au: rescale(a, scale), bu: rescale(b, scale) };
}

export function add(a: Dec, b: Dec): Dec {
  const { scale, au, bu } = align(a, b);
  return dec(au + bu, scale);
}

export function sub(a: Dec, b: Dec): Dec {
  const { scale, au, bu } = align(a, b);
  return dec(au - bu, scale);
}

export function mul(a: Dec, b: Dec): Dec {
  return dec(a.u * b.u, a.s + b.s);
}

export function neg(a: Dec): Dec {
  return dec(-a.u, a.s);
}

export function isZero(a: Dec): boolean {
  return a.u === 0n;
}

/** Division carried to 30 decimal places, rounded half away from zero. */
export function div(a: Dec, b: Dec): Dec {
  const numerator = a.u * pow10(DIV_SCALE + b.s);
  const denominator = b.u * pow10(a.s);
  return dec(divideRounded(numerator, denominator), DIV_SCALE);
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Rounds half away from zero to `places` decimal places. */
export function round(a: Dec, places: number): Dec {
  if (a.s <= places) return dec(rescale(a, places), places);
  const factor = pow10(a.s - places);
  return dec(divideRounded(a.u, factor), places);
}

export function compare(a: Dec, b: Dec): number {
  const { au, bu } = align(a, b);
  return au < bu ? -1 : au > bu ? 1 : 0;
}

export function isWholeNumber(a: Dec): boolean {
  return a.s <= 0 || a.u % pow10(a.s) === 0n;
}

export function toWholeNumber(a: Dec): number | null {
  if (!isWholeNumber(a)) return null;
  const whole = a.s <= 0 ? a.u * pow10(-a.s) : a.u / pow10(a.s);
  const value = Number(whole);
  return Number.isSafeInteger(value) ? value : null;
}

function formatAtScale(a: Dec): string {
  const negative = a.u < 0n;
  const digits = (negative ? -a.u : a.u).toString().padStart(a.s + 1, '0');
  const intPart = digits.slice(0, digits.length - a.s) || '0';
  const fracPart = a.s === 0 ? '' : digits.slice(digits.length - a.s);
  const body = a.s === 0 ? intPart : `${intPart}.${fracPart}`;
  return negative && a.u !== 0n ? `-${body}` : body;
}

/** The canonical stored and displayed form: exactly four decimal places. */
export function formatDecimal(a: Dec): string {
  return formatAtScale(round(a, DISPLAY_SCALE));
}

export function fromInt(value: number): Dec {
  return dec(BigInt(value), 0);
}
