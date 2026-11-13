/**
 * Exact rational arithmetic on BigInt. The rounding rule: compute the exact
 * rational value, never in floating point, and round to the nearest whole
 * number, with an exact half rounding up.
 */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a < 0n ? -a : a;
}

export function rat(num: bigint | number, den: bigint | number = 1n): Rational {
  let n = typeof num === 'number' ? BigInt(num) : num;
  let d = typeof den === 'number' ? BigInt(den) : den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (d === 0n) throw new Error('rational with zero denominator');
  const g = gcd(n, d) || 1n;
  return { num: n / g, den: d / g };
}

export function ratAdd(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function ratSub(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function ratMul(a: Rational, b: Rational): Rational {
  return rat(a.num * b.num, a.den * b.den);
}

export function ratDiv(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den, a.den * b.num);
}

/** Decimal string to exact rational, e.g. "12.34" -> 1234/100. */
export function ratFromDecimal(text: string): Rational {
  const m = /^-?(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (m === null) throw new Error(`not a decimal: ${text}`);
  const digits = m[2] ?? '';
  const scale = 10n ** BigInt(digits.length);
  const sign = text.trim().startsWith('-') ? -1n : 1n;
  return rat(sign * BigInt(m[1] + digits), scale);
}

/** Round to the nearest whole number, exact half rounding up (towards +infinity). */
export function roundRational(r: Rational): number {
  // floor((2*num + den) / (2*den)) implements round-half-up for any sign.
  const twoN = r.num * 2n + r.den;
  const twoD = r.den * 2n;
  let q = twoN / twoD;
  if (twoN % twoD !== 0n && twoN < 0n) q -= 1n;
  return Number(q);
}

export function ratToNumber(r: Rational): number {
  return Number(r.num) / Number(r.den);
}
