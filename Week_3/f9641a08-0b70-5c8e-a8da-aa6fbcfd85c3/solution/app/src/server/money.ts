/** Round num/den half up to a whole number (den > 0, num >= 0), in integer arithmetic. */
export function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
