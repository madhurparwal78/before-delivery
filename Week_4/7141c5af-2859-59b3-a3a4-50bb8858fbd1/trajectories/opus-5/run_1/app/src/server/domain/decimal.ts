/**
 * Exact base-10 arithmetic. Money and every published decimal pass through
 * here and never through a binary floating-point value.
 *
 * A Dec is the rational `units / 10 ** scale` with `scale >= 0`.
 */
export interface Dec {
  readonly units: bigint;
  readonly scale: number;
}

const POW: bigint[] = [];
function pow10(n: number): bigint {
  if (n < 0) throw new RangeError('negative scale');
  for (let i = POW.length; i <= n; i += 1) POW[i] = i === 0 ? 1n : POW[i - 1]! * 10n;
  return POW[n]!;
}

export function dec(units: bigint, scale: number): Dec {
  return { units, scale };
}

export function fromInt(n: number | bigint): Dec {
  return { units: BigInt(n), scale: 0 };
}

const DECIMAL_TEXT = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Reads a decimal string exactly. Returns null for any other text. */
export function parseDec(text: string): Dec | null {
  const m = DECIMAL_TEXT.exec(text);
  if (!m) return null;
  const sign = m[1]!;
  const whole = m[2]!;
  const frac = m[3] ?? '';
  const units = BigInt(whole + frac);
  return { units: sign === '-' ? -units : units, scale: frac.length };
}

/** Reads a decimal string with at most `maxScale` decimals. */
export function parseDecMax(text: string, maxScale: number): Dec | null {
  const d = parseDec(text);
  if (!d) return null;
  return d.scale <= maxScale ? d : null;
}

function align(a: Dec, b: Dec): { a: bigint; b: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  return {
    a: a.units * pow10(scale - a.scale),
    b: b.units * pow10(scale - b.scale),
    scale,
  };
}

export function add(a: Dec, b: Dec): Dec {
  const x = align(a, b);
  return { units: x.a + x.b, scale: x.scale };
}

export function sub(a: Dec, b: Dec): Dec {
  const x = align(a, b);
  return { units: x.a - x.b, scale: x.scale };
}

export function mul(a: Dec, b: Dec): Dec {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

export function cmp(a: Dec, b: Dec): -1 | 0 | 1 {
  const x = align(a, b);
  return x.a < x.b ? -1 : x.a > x.b ? 1 : 0;
}

export function isZero(a: Dec): boolean {
  return a.units === 0n;
}

export function isNegative(a: Dec): boolean {
  return a.units < 0n;
}

/** True when the value has no fractional part. */
export function isWhole(a: Dec): boolean {
  return a.units % pow10(a.scale) === 0n;
}

/** Half up on the exact value, away from zero on an exact half. */
export function roundHalfUp(a: Dec, places: number): Dec {
  if (a.scale <= places) {
    return { units: a.units * pow10(places - a.scale), scale: places };
  }
  const drop = pow10(a.scale - places);
  const neg = a.units < 0n;
  const mag = neg ? -a.units : a.units;
  const q = mag / drop;
  const rest = mag % drop;
  const rounded = rest * 2n >= drop ? q + 1n : q;
  return { units: neg ? -rounded : rounded, scale: places };
}

/** Towards zero. */
export function truncate(a: Dec, places: number): Dec {
  if (a.scale <= places) return { units: a.units * pow10(places - a.scale), scale: places };
  const drop = pow10(a.scale - places);
  const neg = a.units < 0n;
  const mag = neg ? -a.units : a.units;
  const q = mag / drop;
  return { units: neg ? -q : q, scale: places };
}

/** `a / b` rounded half up to `places` decimals. */
export function divHalfUp(a: Dec, b: Dec, places: number): Dec {
  if (b.units === 0n) throw new RangeError('divide by zero');
  const num = a.units * pow10(b.scale + places);
  const den = b.units * pow10(a.scale);
  const neg = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (2n * n + d) / (2n * d);
  return { units: neg ? -q : q, scale: places };
}

/** The least integer not below `a / b`. */
export function ceilDiv(a: Dec, b: Dec): bigint {
  if (b.units === 0n) throw new RangeError('divide by zero');
  let num = a.units * pow10(b.scale);
  let den = b.units * pow10(a.scale);
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  if (num <= 0n) return -(-num / den);
  return (num + den - 1n) / den;
}

/** Floor of the value expressed in `places` decimals, as an integer count. */
export function floorToScale(a: Dec, places: number): bigint {
  const t = truncate(a, places);
  if (a.units < 0n && cmp(t, a) !== 0) return t.units - 1n;
  return t.units;
}

/** Fixed-point text with exactly `places` decimals. */
export function toFixed(a: Dec, places: number): string {
  const r = roundHalfUp(a, places);
  const neg = r.units < 0n;
  const mag = (neg ? -r.units : r.units).toString().padStart(places + 1, '0');
  const whole = mag.slice(0, mag.length - places) || '0';
  const frac = places > 0 ? '.' + mag.slice(mag.length - places) : '';
  return (neg ? '-' : '') + whole + frac;
}

/** Text with the decimals it is stored with. */
export function toPlain(a: Dec): string {
  return toFixed(a, a.scale);
}

/** Groups the whole part in threes with commas. */
export function groupThousands(text: string): string {
  const neg = text.startsWith('-');
  const body = neg ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const whole = dot === -1 ? body : body.slice(0, dot);
  const rest = dot === -1 ? '' : body.slice(dot);
  let out = '';
  for (let i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += ',';
    out += whole[i];
  }
  return (neg ? '-' : '') + out + rest;
}

export const ONE = fromInt(1);
export const HUNDRED = fromInt(100);
