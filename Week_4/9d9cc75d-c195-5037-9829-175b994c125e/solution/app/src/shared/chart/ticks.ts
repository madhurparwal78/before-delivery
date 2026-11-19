// The value-axis tick rule from the brief: always includes 0, a step of 1, 2, 5 or 10 times a power of ten.
import { round9 } from '../display.ts';

/** `values` are the extremes the axis must hold; null entries are ignored. All 0 or null gives 0 and 1. */
export function computeTicks(values: readonly (number | null)[]): number[] {
  let lo = 0;
  let hi = 0;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  if (hi === lo) return [0, 1];
  const raw = (hi - lo) / 4;
  let exponent = Math.floor(Math.log10(raw));
  if (10 ** (exponent + 1) <= raw) exponent += 1;
  if (10 ** exponent > raw) exponent -= 1;
  const multiplier = [1, 2, 5, 10].find((m) => m * 10 ** exponent >= raw) ?? 10;
  const first = Math.floor(round9(lo / (multiplier * 10 ** exponent)));
  const last = Math.ceil(round9(hi / (multiplier * 10 ** exponent)));
  const ticks: number[] = [];
  for (let n = first; n <= last; n += 1) {
    const units = n * multiplier;
    ticks.push(exponent >= 0 ? units * 10 ** exponent : units / 10 ** -exponent);
  }
  return ticks;
}
