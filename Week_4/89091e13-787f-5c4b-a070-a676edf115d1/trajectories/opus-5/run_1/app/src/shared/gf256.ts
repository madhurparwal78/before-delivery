/** GF(2^8) with reduction polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d) and
 *  generator 2, as published. Addition is XOR; multiplication uses log tables. */
const LOG = new Uint8Array(256);
const ANTILOG = new Uint8Array(512);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    ANTILOG[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) ANTILOG[i] = ANTILOG[i - 255];
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return ANTILOG[LOG[a] + LOG[b]];
}

export function gfDiv(a: number, b: number): number {
  if (a === 0) return 0;
  return ANTILOG[LOG[a] + 255 - LOG[b]];
}

/**
 * Lagrange coefficients for evaluating the unique polynomial of degree < k
 * through (0, y0) .. (k-1, y(k-1)) at x. Point i contributes
 * prod_{j != i} (x - xj) / (xi - xj), with subtraction as XOR.
 */
export function lagrangeWeights(k: number, x: number): Uint8Array {
  const weights = new Uint8Array(k);
  for (let i = 0; i < k; i++) {
    let numerator = 1;
    let denominator = 1;
    for (let j = 0; j < k; j++) {
      if (j === i) continue;
      numerator = gfMul(numerator, x ^ j);
      denominator = gfMul(denominator, i ^ j);
    }
    weights[i] = gfDiv(numerator, denominator);
  }
  return weights;
}
