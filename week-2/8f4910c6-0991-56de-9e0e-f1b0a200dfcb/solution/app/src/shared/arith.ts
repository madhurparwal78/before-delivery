/** numerator / denominator rounded half up, for non-negative integers. */
export function halfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
