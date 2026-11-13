export const MINUS = '\u2212';

/** Gold, prices and amounts are shown with two decimals. */
export function gold2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Health, boss health and damage are shown with one decimal. */
export function tenths1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}
