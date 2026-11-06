/** Exact decimal arithmetic on BigInt mantissas. No binary floating point is ever used. */

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

export type ParsedDecimal = { sign: 1 | -1; intPart: string; fracPart: string };

export function parseDecimalString(text: string): ParsedDecimal | null {
  const m = DECIMAL_RE.exec(text);
  if (!m) return null;
  return {
    sign: m[1] === '-' ? -1 : 1,
    intPart: m[2],
    fracPart: m[3] ?? '',
  };
}

/** Exact conversion of a plain decimal string to units of 10^-scale. Fails when more decimals are given. */
export function exactUnits(text: string, scale: number): bigint | null {
  const p = parseDecimalString(text);
  if (!p || p.fracPart.length > scale) return null;
  const frac = p.fracPart.padEnd(scale, '0');
  const units = BigInt(p.intPart + frac);
  return p.sign === -1 ? -units : units;
}

/** floor(n / d) for positive d. */
function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  if (n % d !== 0n && n < 0n) return q - 1n;
  return q;
}

/** Rounds n/d to the nearest integer, halves toward +infinity. d must be positive. */
export function roundHalfUp(n: bigint, d: bigint): bigint {
  return floorDiv(2n * n + d, 2n * d);
}

/** Rounds n/d to the nearest integer, halves to even. d must be positive. */
export function roundHalfEven(n: bigint, d: bigint): bigint {
  const q = floorDiv(n, d);
  const r = n - q * d;
  const twice = 2n * r;
  if (twice > d) return q + 1n;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

export function formatUnits(units: bigint, scale: number): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const s = abs.toString().padStart(scale + 1, '0');
  const intPart = s.slice(0, s.length - scale);
  const frac = scale > 0 ? '.' + s.slice(s.length - scale) : '';
  return (neg ? '-' : '') + intPart + frac;
}

/**
 * Rounds a decimal string (any number of decimals) to `scale` places, halves up.
 * Returns null when the text is not a plain decimal.
 */
export function roundDecimalString(text: string, scale: number): bigint | null {
  const p = parseDecimalString(text);
  if (!p) return null;
  const digits = p.intPart + p.fracPart;
  const extra = p.fracPart.length - scale;
  let units: bigint;
  if (extra <= 0) {
    units = BigInt(digits + '0'.repeat(-extra));
  } else {
    const keep = digits.slice(0, digits.length - extra) || '0';
    const drop = digits.slice(digits.length - extra);
    units = BigInt(keep);
    const half = BigInt('5' + '0'.repeat(extra - 1));
    const dropped = BigInt(drop);
    if (p.sign === 1) {
      if (dropped >= half) units += 1n;
    } else if (dropped > half) {
      units += 1n;
    }
  }
  return p.sign === -1 ? -units : units;
}

/** The shortest decimal text of a JSON number, with any exponent expanded. */
export function numberToDecimalString(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const raw = String(value);
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw);
  if (!m) return raw;
  const sign = m[1];
  const digits = m[2] + (m[3] ?? '');
  const pointAt = m[2].length + Number(m[4]);
  if (pointAt <= 0) return sign + '0.' + '0'.repeat(-pointAt) + digits;
  if (pointAt >= digits.length) return sign + digits + '0'.repeat(pointAt - digits.length);
  return sign + digits.slice(0, pointAt) + '.' + digits.slice(pointAt);
}
