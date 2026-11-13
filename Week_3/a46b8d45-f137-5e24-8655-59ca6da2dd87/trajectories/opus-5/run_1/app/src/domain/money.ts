/**
 * Money crosses two boundaries: integer pence inside the desk and on the wire, and decimal
 * pounds at Kill Bill. Rounding to the penny is half up and happens only here.
 */

/** Half up on the exact value of `numerator / denominator`, both whole numbers. */
export function divideHalfUp(numerator: number, denominator: number): number {
  const whole = Math.floor(numerator / denominator);
  const remainder = numerator - whole * denominator;
  return remainder * 2 >= denominator ? whole + 1 : whole;
}

/** Kill Bill speaks decimal pounds. */
export function poundsFromMinor(minor: number): number {
  return Number((minor / 100).toFixed(2));
}

export function minorFromPounds(pounds: number): number {
  return Math.round(pounds * 100);
}
