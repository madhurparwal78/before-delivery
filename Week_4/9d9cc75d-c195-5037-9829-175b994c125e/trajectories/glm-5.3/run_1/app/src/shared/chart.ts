/**
 * The published chart rules: value-axis ticks, categorical and sequential
 * colours, and the scale mapping. Shared by the browser SVG chart and the
 * server-side PNG export so the rules live in exactly one place.
 */

export interface TickScale {
  ticks: number[];
  step: number;
}

/** Value axes always include 0. */
export function valueTicks(values: (number | null)[]): TickScale {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0 || nums.every((v) => v === 0)) {
    return { ticks: [0, 1], step: 1 };
  }
  const lo = Math.min(0, ...nums);
  const hi = Math.max(0, ...nums);
  const raw = (hi - lo) / 4;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = e;
  for (const m of [1, 2, 5, 10]) {
    if (m * e >= raw) {
      step = m * e;
      break;
    }
  }
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= last + step / 2; t += step) {
    ticks.push(Math.abs(t) < step / 1e6 ? 0 : t);
  }
  if (ticks.length === 1) ticks.push(ticks[0] + step);
  return { ticks, step };
}

/** Categorical colour cycle, in member order. */
export const CATEGORICAL_COLORS: [number, number, number][] = [
  [233, 71, 159],
  [26, 10, 20],
  [217, 225, 63],
  [110, 74, 94],
  [234, 160, 205],
];

export const CATEGORICAL_PATTERNS = ["solid", "dots", "stripes", "checks", "rings"] as const;

export function categoricalColor(index: number): string {
  const c = CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length];
  return `${c[0]}, ${c[1]}, ${c[2]}`;
}

export function categoricalPattern(index: number): string {
  return CATEGORICAL_PATTERNS[index % CATEGORICAL_PATTERNS.length];
}

/** Sequential colour between blush and bubblegum, rounded half up. */
export function sequentialColor(v: number, min: number, max: number): string {
  const t = max === min ? 1 : (v - min) / (max - min);
  const low = [253, 241, 247];
  const high = [233, 71, 159];
  const ch = low.map((l, i) => Math.round(l + (high[i] - l) * t + Number.EPSILON));
  return `${ch[0]}, ${ch[1]}, ${ch[2]}`;
}

/** Map a value to a fraction of the plot length along the value axis. */
export function scaleFraction(value: number, ticks: number[]): number {
  if (ticks.length < 2) return 0;
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  return (value - first) / (last - first);
}
