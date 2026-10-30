/** Exact integer arithmetic helpers. Every money value is integer cents. */

export function divFloor(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

export function divCeil(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n === b < 0n ? q + 1n : q;
}

/** floor(a/b + 1/2) */
export function roundHalfUp(a: bigint, b: bigint): bigint {
  return divFloor(2n * a + b, 2n * b);
}

export function ipow(base: bigint, exp: number): bigint {
  let r = 1n;
  let b = base;
  let e = exp;
  while (e > 0) {
    if (e & 1) r *= b;
    b *= b;
    e >>= 1;
  }
  return r;
}

export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}$${dollars.toLocaleString('en-US')}.${rest}`;
}

/** A per-100,000 rate rendered as a percentage with trailing zeros removed. */
export function formatRatePcm(ratePcm: number): string {
  const whole = Math.floor(ratePcm / 1000);
  const frac = String(ratePcm % 1000).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}%` : `${whole}%`;
}
