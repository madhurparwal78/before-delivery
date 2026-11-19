/** Integer helpers. Division rounds half away from zero; modulo is Euclidean. */
export function divHalf(n: number, d: number): number {
  const q = Math.trunc(n / d);
  return n - d * q >= d - n + d * q ? q + 1 : q;
}

export function mulHalf(n: number, m: number, d: number): number {
  // round(n*m/d) half away from zero, exact for |n*m| < 2^52
  const p = n * m;
  const q = Math.trunc(p / d);
  const r = p - d * q;
  return r * 2 >= d ? q + 1 : r * 2 <= -d ? q - 1 : q;
}

export function halfAway(n: number): number {
  return n >= 0 ? Math.floor(n + 0.5) : Math.ceil(n - 0.5);
}

/** x has the form x/2^52; round half away from zero to an integer. */
export function roundHalfAwayFromPower2(x: number): number {
  const scaled = x * 0x10000000000000;
  return halfAway(scaled);
}

/** Divide a by d, exact, as x = a/d in [0,2). Return roundHalfAwayFromPower2(x). */
export function divPow2(a: number, d: number): number {
  return roundHalfAwayFromPower2(a / d);
}
